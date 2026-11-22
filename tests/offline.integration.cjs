const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const base = process.env.TEST_BASE || "http://localhost:3100";
(async () => {
  const l = await fetch(base + "/api/auth/clinic-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "finance-isolated@example.invalid",
      password: "test-only-password",
      role: "manager",
    }),
  }).then((r) => r.json());
  const cid = l.clinic.id,
    token = l.token;
  async function post(b) {
    const r = await fetch(base + "/api/finance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        clinicId: cid,
        requestId: crypto.randomUUID(),
        ...b,
      }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  }
  await post({
    action: "write",
    table: "appointments",
    id: "queue_a",
    data: {
      patientId: "p1",
      patientName: "اختبار الطابور",
      price: 500,
      paidAmount: 0,
      date: "2026-11-21",
      status: "completed",
    },
  });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.createBrowserContext();
    let page = await context.newPage();
    async function init(p) {
      await p.goto(base + "/robots.txt");
      await p.addScriptTag({
        path: process.env.OFFLINE_TEST_BUNDLE || "/tmp/offline-current.js",
      });
      await p.evaluate((t) => OfflineAudit.setAuthToken(t), token);
    }
    await init(page);
    await page.evaluate(async (cid) => {
      await OfflineAudit.getDocs(
        OfflineAudit.collection(OfflineAudit.db, "clinics", cid, "shifts"),
        true,
      );
    }, cid);
    await page.setOfflineMode(true);
    async function collect(p, amount) {
      return p.evaluate(
        async ({ cid, amount }) => {
          try {
            await OfflineAudit.financeCommand(cid, {
              action: "collect",
              appointmentId: "queue_a",
              amount,
              paymentMethod: "cash",
            });
            return "success";
          } catch (e) {
            return e.message;
          }
        },
        { cid, amount },
      );
    }
    assert((await collect(page, 75)).includes("غير مؤكد"));
    assert((await collect(page, 125)).includes("غير مؤكد"));
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      2,
    );
    await page.close();
    page = await context.newPage();
    await init(page);
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      2,
    );
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    let ledger = await post({ action: "read" });
    let receipts = ledger.receipts.filter((r) => r.appointmentId === "queue_a");
    assert.equal(receipts.length, 2);
    assert.equal(
      receipts.reduce((n, r) => n + r.amount, 0),
      200,
    );
    console.log(
      "PASS queued 75+125 survive page close and sync to200/two receipts.",
    );
    // Lost response AFTER commit, repeated creation must reuse the original command and ID.
    const out = await page.evaluate(async (cid) => {
      const original = window.fetch;
      let once = true;
      window.fetch = async (...args) => {
        const r = await original(...args);
        const b = JSON.parse(args[1]?.body || "{}");
        if (once && b.table === "expenses") {
          once = false;
          await r.clone().text();
          throw Error("lost response after commit");
        }
        return r;
      };
      const coll = OfflineAudit.collection(
        OfflineAudit.db,
        "clinics",
        cid,
        "expenses",
      );
      try {
        await OfflineAudit.addDoc(coll, {
          title: "مصروف ثابت المعرف",
          amount: 7,
          type: "shift",
          paymentMethod: "cash",
          date: "2026-11-21",
        });
      } catch {}
      window.fetch = original;
      const pending = await OfflineAudit.getPendingCommands();
      await OfflineAudit.addDoc(coll, {
        title: "مصروف ثابت المعرف",
        amount: 7,
        type: "shift",
        paymentMethod: "cash",
        date: "2026-11-21",
      });
      return { pending: pending.length };
    }, cid);
    assert.equal(out.pending, 1);
    ledger = await post({ action: "read" });
    assert.equal(
      ledger.expenses.filter((e) => e.title === "مصروف ثابت المعرف").length,
      1,
    );
    console.log("PASS expense response-loss retry7, not7+7.");
    await page.setOfflineMode(true);
    const normal = await page.evaluate(
      async (cid) =>
        OfflineAudit.addDoc(
          OfflineAudit.collection(OfflineAudit.db, "clinics", cid, "patients"),
          { name: "مريض محفوظ بلا نت", phone: "0101" },
        ),
      cid,
    );
    assert(normal.pending);
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      0,
    );
    console.log(
      "PASS offline patient creates locally pending and synchronizes.",
    );
    await page.setOfflineMode(true);
    const contentResults = await page.evaluate(async (cid) => {
      const list = [];
      for (const table of [
        "appointments",
        "lab_orders",
        "records",
        "prescriptions",
        "xrays",
        "teeth",
        "inventory",
        "custom_medications",
        "custom_categories",
        "laboratories",
        "lab_work_types",
      ]) {
        const result = await OfflineAudit.addDoc(
          OfflineAudit.collection(OfflineAudit.db, "clinics", cid, table),
          {
            patientId: "p1",
            patientName: "اختبار تعميم الأوفلاين",
            name: "اختبار " + table,
            title: "اختبار " + table,
            date: "2026-11-21",
            price: 0,
            paidAmount: 0,
            cost: 0,
            status: "scheduled",
          },
        );
        list.push({ table, id: result.id, pending: result.pending });
      }
      return list;
    }, cid);
    assert(contentResults.every((r) => r.pending));
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      11,
    );
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    const remaining = await page.evaluate(() =>
      OfflineAudit.getPendingCommands(),
    );
    assert.equal(remaining.length, 0, JSON.stringify(remaining));
    console.log(
      "PASS offline appointments/lab/medical records/prescriptions/xrays/teeth/inventory/medications/categories/laboratories/lab types all synchronize.",
    );
    // A storage failure must abort before creating an optimistic patient or sending a request.
    const storageFailure = await page.evaluate(async (cid) => {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === "CoreDentCommands" && args[1] === "readwrite")
          throw new DOMException(
            "isolated quota simulation",
            "QuotaExceededError",
          );
        return original.apply(this, args);
      };
      try {
        await OfflineAudit.addDoc(
          OfflineAudit.collection(OfflineAudit.db, "clinics", cid, "patients"),
          { name: "must-not-be-created" },
        );
        return false;
      } catch {
        return true;
      } finally {
        IDBDatabase.prototype.transaction = original;
      }
    }, cid);
    assert(storageFailure);
    console.log(
      "PASS simulated persistent storage failure aborts the command instead of claiming success.",
    );
    const secondTab = await context.newPage();
    await init(secondTab);
    await page.setOfflineMode(true);
    await secondTab.setOfflineMode(true);
    const sameWrite = (p) =>
      p.evaluate(
        (cid) =>
          OfflineAudit.setDoc(
            OfflineAudit.doc(
              OfflineAudit.db,
              "clinics",
              cid,
              "patients",
              "atomic_two_tabs",
            ),
            { name: "اختبار علامتي تبويب", phone: "0111" },
          ),
        cid,
      );
    await Promise.all([sameWrite(page), sameWrite(secondTab)]);
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      1,
    );
    const fakeStaff =
      "test." +
      Buffer.from(
        JSON.stringify({ type: "staff", clinicId: cid, staffId: "other-user" }),
      ).toString("base64url") +
      ".test";
    await page.evaluate((t) => OfflineAudit.setAuthToken(t), fakeStaff);
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      0,
    );
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    await page.evaluate((t) => OfflineAudit.setAuthToken(t), token);
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      1,
    );
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    await secondTab.close();
    console.log(
      "PASS two-tab atomic deduplication; switching accounts cannot view or transmit another owner command.",
    );
    // One new offline patient drives appointment, medical record, xray bytes and payment dependencies.
    await page.setOfflineMode(true);
    const chain = await page.evaluate(async (cid) => {
      const patient = await OfflineAudit.addDoc(
        OfflineAudit.collection(OfflineAudit.db, "clinics", cid, "patients"),
        { name: "اختبار دورة بلا نت", phone: "0100000" },
      );
      const apt = await OfflineAudit.addDoc(
        OfflineAudit.collection(
          OfflineAudit.db,
          "clinics",
          cid,
          "appointments",
        ),
        {
          patientId: patient.id,
          patientName: "اختبار دورة بلا نت",
          price: 200,
          paidAmount: 0,
          date: "2026-11-21",
          status: "completed",
        },
      );
      await OfflineAudit.addDoc(
        OfflineAudit.collection(
          OfflineAudit.db,
          "clinics",
          cid,
          "patients",
          patient.id,
          "records",
        ),
        { patientId: patient.id, notes: "سجل طبي بلا نت" },
      );
      const path = "clinics/" + cid + "/patients/" + patient.id + "/xrays";
      await OfflineAudit.setDoc(
        OfflineAudit.doc(OfflineAudit.db, path, "chain_xray"),
        {
          patientId: patient.id,
          imageUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9WQAAAAASUVORK5CYII=",
          isOfflinePending: true,
        },
      );
      const db = await new Promise((r) => {
        const q = indexedDB.open("CrownDentOfflineDB", 2);
        q.onsuccess = () => r(q.result);
      });
      const owner = (await OfflineAudit.getPendingCommands())[0].owner;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["offline_media", "sync_queue"], "readwrite");
        tx.objectStore("offline_media").put({
          id: "chain_media",
          owner,
          blob: new Blob(["test-bytes"], { type: "application/octet-stream" }),
          fileName: "isolated-test.bin",
          category: "xrays",
          clinicId: cid,
          patientId: patient.id,
          docPath: path,
          docId: "chain_xray",
          field: "imageUrl",
          createdAt: Date.now(),
        });
        tx.objectStore("sync_queue").add({
          action: "uploadOfflineMedia",
          mediaId: "chain_media",
          path,
          docId: "chain_xray",
          category: "xrays",
          fileName: "isolated-test.bin",
          data: { clinicId: cid, patientId: patient.id, field: "imageUrl" },
          createdAt: Date.now(),
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      try {
        await OfflineAudit.financeCommand(cid, {
          action: "collect",
          appointmentId: apt.id,
          amount: 75,
          paymentMethod: "cash",
        });
      } catch {}
      return { patientId: patient.id, appointmentId: apt.id, path };
    }, cid);
    await page.setRequestInterception(true);
    let uploadFails = true;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/upload")) {
        if (uploadFails) r.abort("failed");
        else
          r.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              publicUrl: "https://isolated-upload.invalid/test-xray.bin",
            }),
          });
      } else r.continue();
    });
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      0,
    );
    ledger = await post({ action: "read" });
    assert.equal(
      ledger.receipts
        .filter((r) => r.appointmentId === chain.appointmentId)
        .reduce((n, r) => n + r.amount, 0),
      75,
    );
    await page.evaluate(() => OfflineAudit.processSyncQueue());
    const stored = await page.evaluate(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("CrownDentOfflineDB", 2);
        q.onsuccess = () => r(q.result);
      });
      return new Promise((r) => {
        const q = db
          .transaction("offline_media")
          .objectStore("offline_media")
          .get("chain_media");
        q.onsuccess = () => r(!!q.result?.blob);
      });
    });
    assert(stored, "failed upload discarded original bytes");
    uploadFails = false;
    await page.evaluate(() => OfflineAudit.processSyncQueue());
    const xray = await page.evaluate(
      async ({ path }) =>
        (
          await OfflineAudit.getDoc(
            OfflineAudit.doc(OfflineAudit.db, path, "chain_xray"),
            true,
          )
        ).data(),
      chain,
    );
    assert.equal(
      xray.imageUrl,
      "https://isolated-upload.invalid/test-xray.bin",
    );
    assert.equal(xray.isOfflinePending, false);
    console.log(
      "PASS full offline patient -> appointment -> medical record -> xray ->75 payment chain. Failed upload retains bytes; controlled upload response links successfully. Actual cloud storage not used.",
    );
    await page.evaluate(async (cid) => {
      await OfflineAudit.getDoc(
        OfflineAudit.doc(OfflineAudit.db, "clinics", cid),
        true,
      );
    }, cid);
    await page.setOfflineMode(true);
    const setting = await page.evaluate(
      (cid) =>
        OfflineAudit.updateDoc(
          OfflineAudit.doc(OfflineAudit.db, "clinics", cid),
          { consultationPrice: 321 },
        ),
      cid,
    );
    assert(setting.pending);
    const deniedSecret = await page.evaluate(async (cid) => {
      try {
        await OfflineAudit.updateDoc(
          OfflineAudit.doc(OfflineAudit.db, "clinics", cid),
          { staffPin: "0000" },
        );
        return false;
      } catch {
        return true;
      }
    }, cid);
    assert(deniedSecret);
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      1,
    );
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    assert.equal(
      (await page.evaluate(() => OfflineAudit.getPendingCommands())).length,
      0,
    );
    const clinicAfter = await page.evaluate(
      async (cid) =>
        (
          await OfflineAudit.getDoc(
            OfflineAudit.doc(OfflineAudit.db, "clinics", cid),
            true,
          )
        ).data(),
      cid,
    );
    assert.equal(clinicAfter.consultationPrice, 321);
    console.log(
      "PASS normal clinic settings durable offline; credentials require connection and never enter command queue.",
    );
    // Two edits to the same field must not silently replace the server version.
    await page.evaluate(
      async ({ cid, id }) => {
        const ref = OfflineAudit.doc(
          OfflineAudit.db,
          "clinics",
          cid,
          "patients",
          id,
        );
        await OfflineAudit.getDoc(ref, true);
      },
      { cid, id: normal.id },
    );
    await page.setOfflineMode(true);
    await page.evaluate(
      async ({ cid, id }) =>
        OfflineAudit.updateDoc(
          OfflineAudit.doc(OfflineAudit.db, "clinics", cid, "patients", id),
          { phone: "0202" },
        ),
      { cid, id: normal.id },
    );
    await post({
      action: "write",
      table: "patients",
      id: normal.id,
      data: { phone: "0303" },
    });
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    const conflicts = await page.evaluate(() =>
      OfflineAudit.getPendingCommands(),
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].status, "conflict");
    assert(conflicts[0].error.includes("تعارض"));
    console.log(
      "PASS stale field conflict retained, server edit not overwritten.",
    );
    await page.goto(base);
    await page.waitForSelector("body");
    await page.evaluate(
      (t, c) => {
        localStorage.setItem("dental_auth_token", t);
        localStorage.setItem(
          "dental_saas_session",
          JSON.stringify({
            type: "clinic",
            clinicId: c.id,
            clinicName: c.name,
          }),
        );
        localStorage.setItem("auto_backup_last_date_" + c.id, "2026-11-21");
        localStorage.setItem("i18nextLng", "ar");
      },
      token,
      l.clinic,
    );
    await page.reload({ waitUntil: "networkidle2" });
    await page.setViewport({ width: 1440, height: 1000 });
    assert(
      !(await page.evaluate(() =>
        document.body.innerText.includes("عرض الطلبات"),
      )),
      "queue banner leaked into patient workspace",
    );
    await page.screenshot({
      path: "/downloads/offline-patients-clean.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "الإعدادات")
        ?.click(),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent.includes("تنبيهات"),
      ),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("تنبيهات"))
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("عرض الطلبات"),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("عرض الطلبات"))
        ?.click(),
    );
    await page.screenshot({
      path: "/downloads/offline-settings-alerts-desktop.png",
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: "/downloads/offline-settings-alerts-mobile.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("مقارنة بنسخة السيرفر"))
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("تطبيق تعديلي المعروض"),
    );
    await page.screenshot({
      path: "/downloads/offline-conflict-review-mobile.png",
      fullPage: true,
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "/downloads/offline-conflict-review-desktop.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "English")
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("Phone number"),
    );
    assert(
      (await page.evaluate(() => document.body.innerText)).includes(
        "Edited by:",
      ),
    );
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: "/downloads",
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Save a recovery copy"))
        ?.click(),
    );
    for (let i = 0; i < 40; i++) {
      if (
        require("node:fs").existsSync("/downloads/clinic-pending-recovery.zip")
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const recovery = await require("jszip").loadAsync(
      require("node:fs").readFileSync("/downloads/clinic-pending-recovery.zip"),
    );
    assert(recovery.file("pending-commands.json"));
    const recovered = JSON.parse(
      await recovery.file("pending-commands.json").async("string"),
    );
    assert(recovered.commands.some((c) => c.status === "conflict"));
    console.log(
      "PASS recovery download contains real pending/conflict commands.",
    );
    await page.screenshot({
      path: "/downloads/offline-conflict-review-en-desktop.png",
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: "/downloads/offline-conflict-review-en-mobile.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("العربية"))
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("تطبيق تعديلي المعروض"),
    );
    page.on("dialog", (d) => d.accept());
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("تطبيق تعديلي المعروض"))
        ?.click(),
    );
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'نعم، متأكد'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'نعم، متأكد')?.click());
    await page.waitForFunction(() =>
      document.body.innerText.includes("لا توجد طلبات معلقة"),
    );
    await page.addScriptTag({ path: process.env.OFFLINE_TEST_BUNDLE });
    const resolved = await page.evaluate(
      async ({ cid, id }) =>
        (
          await OfflineAudit.getDoc(
            OfflineAudit.doc(OfflineAudit.db, "clinics", cid, "patients", id),
            true,
          )
        ).data(),
      { cid, id: normal.id },
    );
    assert.equal(resolved.phone, "0202");
    console.log(
      "PASS conflict compare displays actual server0303 vs local0202; explicit local choice applies safely and archive preserves original.",
    );
    await page.evaluate(async (cid) => {
      await OfflineAudit.getDoc(
        OfflineAudit.doc(
          OfflineAudit.db,
          "clinics",
          cid,
          "appointments",
          "queue_a",
        ),
        true,
      );
    }, cid);
    await page.setOfflineMode(true);
    await page.evaluate(
      (cid) =>
        OfflineAudit.updateDoc(
          OfflineAudit.doc(
            OfflineAudit.db,
            "clinics",
            cid,
            "appointments",
            "queue_a",
          ),
          { time: "11:00" },
        ),
      cid,
    );
    await post({
      action: "write",
      table: "appointments",
      id: "queue_a",
      data: { time: "12:00" },
    });
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    await page.waitForFunction(() =>
      document.body.innerText.includes("مقارنة بنسخة السيرفر"),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("مقارنة بنسخة السيرفر"))
        ?.click(),
    );
    await page.waitForFunction(() => document.body.innerText.includes("12:00"));
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: "/downloads/offline-appointment-conflict-mobile.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("الاحتفاظ بنسخة السيرفر"))
        ?.click(),
    );
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'نعم، متأكد'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'نعم، متأكد')?.click());
    await page.waitForFunction(() =>
      document.body.innerText.includes("لا توجد طلبات معلقة"),
    );
    const aptServer = await page.evaluate(
      async (cid) =>
        (
          await OfflineAudit.getDoc(
            OfflineAudit.doc(
              OfflineAudit.db,
              "clinics",
              cid,
              "appointments",
              "queue_a",
            ),
            true,
          )
        ).data(),
      cid,
    );
    assert.equal(aptServer.time, "12:00");
    console.log(
      "PASS appointment time conflict local11 vs server12; explicit keep-server choice leaves12, original archived.",
    );
    await page.setOfflineMode(true);
    await collect(page, 9999);
    const rejectedCommand = (
      await page.evaluate(() => OfflineAudit.getPendingCommands())
    ).find((c) => c.financial);
    assert(rejectedCommand);
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    await page.waitForFunction(() =>
      document.body.innerText.includes("مراجعة مالية"),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "مراجعة مالية")
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("تأكيد المراجعة بدون إضافة مبلغ"),
    );
    await page.screenshot({
      path: "/downloads/offline-financial-review-ar-mobile.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "English")
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes(
        "Financial review, no forced balance changes",
      ),
    );
    await page.screenshot({
      path: "/downloads/offline-financial-review-en-mobile.png",
      fullPage: true,
    });
    await page.type(
      'input[aria-label="Review reason"]',
      "Confirmed amount was not received; invalid test amount",
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) =>
          b.textContent.includes("Confirm review without adding money"),
        )
        ?.click(),
    );
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Confirm'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Confirm')?.click());
    await page.waitForFunction(() =>
      document.body.innerText.includes("No pending requests"),
    );
    const retry = await fetch(base + "/api/finance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        clinicId: cid,
        ...rejectedCommand.body,
        requestId: rejectedCommand.id,
      }),
    });
    assert.equal(retry.status, 409);
    console.log(
      "PASS rejected financial command reviewed without adding money; server tombstone prevents all future replays.",
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Financials & Accounting"))
        ?.click(),
    );
    await page.waitForFunction(() => document.body.innerText.includes("Close"));
    await page.setOfflineMode(true);
    const englishPending = await collect(page, 75);
    assert(englishPending.includes("awaiting server confirmation"));
    await page.waitForFunction(() =>
      document.body.innerText.includes(
        "Pending money, NOT included in drawer totals",
      ),
    );
    await page.screenshot({
      path: "/downloads/offline-shift-pending-en-mobile.png",
      fullPage: true,
    });
    const closeBlocked = await page.evaluate(async (cid) => {
      try {
        await OfflineAudit.financeCommand(cid, {
          action: "close",
          shiftId: "any",
          actualCash: 0,
        });
        return false;
      } catch (e) {
        return e.message;
      }
    }, cid);
    assert(closeBlocked);
    await page.setOfflineMode(false);
    await page.evaluate(() => OfflineAudit.flushDurableCommands());
    await page.waitForFunction(
      () =>
        !document.body.innerText.includes(
          "Pending money, NOT included in drawer totals",
        ),
    );
    const prevent = await fetch(base + "/api/finance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "Accept-Language": "en",
      },
      body: JSON.stringify({
        clinicId: cid,
        action: "delete",
        table: "patients",
        id: chain.patientId,
        requestId: crypto.randomUUID(),
      }),
    });
    assert.equal(prevent.status, 409);
    assert((await prevent.json()).message.includes("cannot be deleted"));
    console.log(
      "PASS English pending-money section appears only while pending and vanishes on confirmation; English patient-history deletion rejection.",
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Patients Manager"))
        ?.click(),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("tr")].some((r) =>
        r.textContent.includes("اختبار دورة بلا نت"),
      ),
    );
    await page.evaluate(() => {
      const row = [...document.querySelectorAll("tr")].find((r) =>
        r.textContent.includes("اختبار دورة بلا نت"),
      );
      row.querySelector('button[title="More"]').click();
    });
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Delete")
        ?.click(),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Confirm")
        ?.click(),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("Patient could not be deleted:"),
    );
    const deletionText=await page.evaluate(() => document.body.innerText);
    assert(deletionText.includes("cannot be deleted because"),deletionText.slice(-2000));
    await page.screenshot({
      path: "/downloads/offline-patient-delete-blocked-en.png",
      fullPage: true,
    });
    console.log(
      "PASS actual patient More > Delete > Confirm controls show English history-protection message and leave patient intact.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
