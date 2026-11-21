const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const base = process.env.TEST_BASE || "http://localhost:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const login = await fetch(base + "/api/auth/clinic-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "finance-isolated@example.invalid",
      password: "test-only-password",
      role: "manager",
    }),
  }).then((r) => r.json());
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(
      (token, c) => {
        localStorage.setItem("dental_auth_token", token);
        localStorage.setItem(
          "dental_saas_session",
          JSON.stringify({
            type: "clinic",
            clinicId: c.id,
            clinicName: c.name,
          }),
        );
        localStorage.setItem("i18nextLng", "ar");
        localStorage.setItem("auto_backup_last_date_" + c.id, "2026-11-21");
      },
      login.token,
      login.clinic,
    );
    await page.goto(base, { waitUntil: "networkidle2" });
    const click = async (text) => {
      const found = await page.evaluate((t) => {
        const b = [...document.querySelectorAll("button,a")].find(
          (b) => b.getClientRects().length && b.textContent.includes(t),
        );
        if (b) b.click();
        return !!b;
      }, text);
      assert(found, "missing button " + text);
      await sleep(600);
    };
    await click("الحسابات والمالية");
    await click("سجل المرتجعات");
    await page.waitForFunction(() =>
      document.body.innerText.includes("رد فعلي اختباري"),
    );
    assert(
      !(await page.evaluate(() => document.body.innerText)).includes(
        "في انتظار تحميل",
      ),
    );
    await page.screenshot({
      path: "/downloads/finance-v3-desktop-ar.png",
      fullPage: true,
    });
    await page.select('select[aria-label="نوع العملية"]', "refund");
    assert.equal(await page.$$eval("article", (els) => els.length), 1);
    await page.select('select[aria-label="نوع العملية"]', "all");
    await page.type('input[aria-label="بحث المرتجعات"]', "لايوجد");
    assert.equal(await page.$$eval("article", (els) => els.length), 0);
    await page.$eval('input[aria-label="بحث المرتجعات"]', (e) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(e, "");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(600);
    await page.setViewport({ width: 390, height: 844 });
    await sleep(500);
    await page.screenshot({
      path: "/downloads/finance-v3-mobile-ar.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "horizontal overflow",
    );
    await click("تسجيل رد مبلغ فعلي");
    await page.select(
      'select[aria-label="الإيصال الأصلي"]',
      await page.$eval(
        'select[aria-label="الإيصال الأصلي"]',
        (e) => e.options[1]?.value,
      ),
    );
    await page.type('input[aria-label="المبلغ المسترد"]', "5");
    await page.type(
      'input[aria-label="سبب الاسترداد"]',
      "اختبار رد فعلي من الواجهة",
    );
    await click("تأكيد رد المبلغ فعليًا");
    await page.waitForFunction(() =>
      document.body.innerText.includes("اختبار رد فعلي من الواجهة"),
    );
    console.log("PASS UI filters/search/responsive actual refund button.");
    await page.setViewport({ width: 1440, height: 1000 });
    await click("English");
    await page.waitForFunction(() =>
      document.body.innerText.includes("Returns Log"),
    );
    await page.screenshot({
      path: "/downloads/finance-v3-desktop-en.png",
      fullPage: true,
    });
    await page.setViewport({ width: 390, height: 844 });
    await sleep(500);
    await page.screenshot({
      path: "/downloads/finance-v3-mobile-en.png",
      fullPage: true,
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await click("العربية");
    await click("سجل الإقفال التاريخي");
    await page.waitForFunction(() =>
      document.body.innerText.includes("المتوقع بالدرج"),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("عرض التقرير"))
        ?.click(),
    );
    await sleep(500);
    console.log(
      "HISTORY TEXT",
      await page.evaluate(() => document.body.innerText.slice(-700)),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("طباعة تقرير الوردية الشامل"))
        ?.click(),
    );
    await page.waitForSelector('iframe[title="print-frame-isolated"]');
    await sleep(100);
    const printText = await page.$eval(
      '[aria-hidden="true"][style*="9999"]',
      (e) => e.innerText,
    );
    assert(
      printText.includes("330"),
      "closed snapshot changed after later refund",
    );
    assert(!printText.includes("NaN"));
    const printElement = await page.$('[aria-hidden="true"][style*="9999"]');
    await page.evaluate((el) => {
      el.style.position = "absolute";
      el.style.left = "0";
      el.style.top = "0";
      el.style.zIndex = "999999";
      el.style.background = "white";
      el.removeAttribute("aria-hidden");
    }, printElement);
    await printElement.screenshot({
      path: "/downloads/finance-closed-snapshot-print.png",
    });
    console.log(
      "PASS immutable closed-shift print from snapshot, 330 remains unchanged after later refunds.",
    );
    console.log("ERRORS", errors);
    assert.equal(errors.length, 0);
    console.log("PASS AR/EN desktop/mobile screenshots and no page errors.");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
