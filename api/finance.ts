import {sameValue, SERVER_METADATA} from '../src/utils/documentComparison';
import { commandMessage } from "../src/utils/commandMessages";
import crypto from "node:crypto";
export class FinanceError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}
const fail = (message: string, status = 409, details?: any): never => {
  throw new FinanceError(status, message, details);
};
export const cents = (v: any): number => {
  const n = Number(v);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001 ||
    n > 1e9
  )
    fail("مبلغ غير صالح، استخدم قيمة موجبة بدقة قرش", 400);
  return Math.round(n * 100);
};
const egp = (n: number) => n / 100;
const day = (s: string) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(s));
  return ["year", "month", "day"]
    .map((k) => p.find((x) => x.type === k)?.value)
    .join("-");
};
const method = (m: any) => {
  const s = String(m || "كاش").trim();
  if (/cash|كاش|نقد/i.test(s)) return "كاش";
  if (/card|visa|فيزا|بطاق/i.test(s)) return "فيزا";
  if (/instapay|انستا|إنستا/i.test(s)) return "إنستاباي";
  if (/wallet|محفظ/i.test(s)) return "محفظة";
  if (/نقاط|نقط|loyalty/i.test(s)) return "نقاط الولاء";
  return s;
};
const contentTables = [
  "records",
  "prescriptions",
  "xrays",
  "teeth",
  "inventory",
  "custom_medications",
  "custom_categories",
  "laboratories",
  "lab_work_types",
];
export function createFinanceService(deps: any) {
  const { db, getAuth, broadcast, mapColumns } = deps;
  let ready: Promise<any> | null = null;
  const ensure = () =>
    (ready ||= db
      .financeTransaction("__finance_schema__", () =>
        db.execute(
          "CREATE TABLE IF NOT EXISTS finance_state (id TEXT PRIMARY KEY, data TEXT, createdAt TEXT)",
        ),
      )
      .catch((e: any) => {
        ready = null;
        throw e;
      }));
  const unpack = (r: any) => {
    let d: any = {};
    try {
      d =
        typeof r.data === "object" && r.data !== null
          ? r.data
          : JSON.parse(r.data || "{}");
    } catch {}
    return { ...r, ...d, id: r.id };
  };
  async function rows(table: string, cid: string) {
    const r = await db.execute({
      sql: `SELECT * FROM ${table} WHERE clinicId = ?`,
      args: [cid],
    });
    return r.rows.map(unpack);
  }
  async function get(table: string, id: string, cid: string) {
    const r = await db.execute({
      sql: `SELECT * FROM ${table} WHERE id = ?`,
      args: [id],
    });
    const d = r.rows[0] ? unpack(r.rows[0]) : null;
    if (
      d &&
      !(table === "clinics" && id === cid) &&
      String(d.clinicId || d.clinicid) !== cid
    )
      fail("غير مصرح", 403);
    return d;
  }
  async function put(table: string, id: string, cid: string, data: any) {
    const prev = await get(table, id, cid);
    const full = { ...(prev || {}), ...data, id, clinicId: cid };
    delete full.data;
    const { cols, vals } = mapColumns
      ? mapColumns(
          table,
          id,
          full,
          cid,
          full.patientId,
          full.createdAt || new Date().toISOString(),
        )
      : {
          cols: ["id", "clinicId", "data", "createdAt"],
          vals: [
            id,
            cid,
            JSON.stringify(full),
            full.createdAt || new Date().toISOString(),
          ],
        };
    if (prev) {
      const pairs = cols
        .map((c: string, i: number) => ({ c, v: vals[i] }))
        .filter((x: any) => x.c !== "id");
      await db.execute({
        sql: `UPDATE ${table} SET ${pairs.map((x: any) => x.c + " = ?").join(", ")} WHERE id = ?`,
        args: [...pairs.map((x: any) => x.v), id],
      });
    } else
      await db.execute({
        sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        args: vals,
      });
    return full;
  }
  async function load(cid: string) {
    const r = await db.execute({
      sql: "SELECT * FROM finance_state WHERE id = ?",
      args: [cid],
    });
    const raw = r.rows[0]?.data;
    const s =
      typeof raw === "object" && raw !== null
        ? raw
        : raw
          ? JSON.parse(raw)
          : {};
    return { version: 1, receipts: [], events: [], requests: {}, ...s };
  }
  async function save(cid: string, s: any) {
    const r = await db.execute({
      sql: "SELECT id FROM finance_state WHERE id = ?",
      args: [cid],
    });
    if (r.rows.length)
      await db.execute({
        sql: "UPDATE finance_state SET data = ? WHERE id = ?",
        args: [JSON.stringify(s), cid],
      });
    else
      await db.execute({
        sql: "INSERT INTO finance_state (id,data,createdAt) VALUES (?,?,?)",
        args: [cid, JSON.stringify(s), new Date().toISOString()],
      });
  }
  async function actor(auth: any, cid: string) {
    const clinic = await get("clinics", cid, cid);
    if (!clinic) fail("العيادة غير موجودة", 404);
    if (auth.type === "staff") {
      const staff = (clinic.staffMembers || []).find(
        (m: any) => m.id === auth.staffId,
      );
      if (!staff) fail("حساب الموظف غير موجود، سجل الدخول بحساب مسمى", 403);
      auth.staffName = staff.name;
      auth.staffRole = staff.role;
      auth.allowedTabs = staff.allowedTabs || [];
    }
    return {
      name:
        auth.type === "staff"
          ? auth.staffName
          : clinic.doctorName || clinic.name,
      role: auth.type === "staff" ? auth.staffRole || "موظف" : "المدير",
      id: auth.staffId || auth.staffName || auth.type,
      clinic,
    };
  }
  function permission(auth: any, action: string) {
    if (auth.type !== "staff") return;
    if (!auth.staffId || !auth.staffName || auth.staffName === "طاقم العيادة")
      fail("يلزم دخول بحساب موظف مسمى لتسجيل الحركات المالية", 403);
    if (
      [
        "refund",
        "discount",
        "delete",
        "lab_cancel",
        "patient_delete",
        "assign_legacy",
        "review_pending",
        "inspect_pending",
      ].includes(action)
    )
      fail("هذه العملية متاحة للمدير فقط", 403);
    const tabs = auth.allowedTabs || [];
    if (action === "write") return; // Table-specific permissions are enforced before a write.
    const key = ["open", "close"].includes(action)
      ? "financials_daily_closing"
      : action === "expense"
        ? "financials_expenses"
        : action === "read"
          ? "financials_reports"
          : "financials_patients_installments";
    const granular = tabs.some((t: string) => t.startsWith("financials_"));
    if (
      !tabs.includes(key) &&
      !(tabs.includes("financials") && !granular) &&
      !(action === "read" && granular)
    )
      fail("لا توجد صلاحية لهذه العملية المالية", 403);
  }
  async function active(cid: string, required = true) {
    const shifts = (await rows("shifts", cid)).filter(
      (s: any) => s.status === "open",
    );
    if (shifts.length > 1)
      fail("توجد ورديات متعارضة تحتاج تسوية يدوية من المدير");
    if (required && !shifts.length) fail("افتح وردية قبل تسجيل حركة مالية");
    return shifts[0] || null;
  }
  function payments(app: any) {
    const ps = Array.isArray(app.payments) ? [...app.payments] : [];
    const sum = ps.reduce((n: number, p: any) => n + cents(p.amount || 0), 0),
      paid = cents(app.paidAmount || 0);
    if (paid > sum)
      ps.unshift({
        id: "pay_init_" + app.id,
        amount: egp(paid - sum),
        paymentMethod: app.paymentMethod || "كاش",
        date: app.paymentDate || app.date,
        type: "initial",
        legacy: true,
      });
    return ps;
  }
  function balance(app: any) {
    if (app.paidAmount === undefined && Number(app.price) > 0)
      fail(
        "موعد قديم بلا رصيد مدفوع صريح، يلزم مراجعة المدير دون تعديل تلقائي",
      );
    const paid = cents(app.paidAmount || 0),
      price = cents(app.price || 0);
    if (paid > price) fail("رصيد قديم غير متسق يحتاج مراجعة المدير");
    return { paid, price, remaining: price - paid };
  }
  function event(
    s: any,
    who: any,
    kind: string,
    source: any,
    amount: number,
    reason: string,
    extra: any = {},
  ) {
    const ev = {
      id: crypto.randomUUID(),
      type: kind,
      sourceId: source.id,
      patientId: source.patientId || null,
      title: source.patientName || source.title || source.workType || source.id,
      amount: egp(amount),
      reason,
      createdAt: new Date().toISOString(),
      actorName: who.name,
      actorRole: who.role,
      actorId: who.id,
      ...extra,
    };
    s.events.push(ev);
    return ev;
  }
  async function receiptProjection(cid: string, s: any) {
    const out: any[] = [];
    for (const a of await rows("appointments", cid))
      for (const p of payments(a)) {
        if (s.receipts.some((r: any) => r.id === p.id)) continue;
        const ts =
          p.createdAt && Number.isFinite(Date.parse(p.createdAt))
            ? p.createdAt
            : null;
        const date =
          p.legacy || /^pay_(init|dup)_/.test(p.id || "")
            ? p.date
            : ts
              ? day(ts)
              : p.date || a.date;
        out.push({
          ...p,
          patientName: a.patientName,
          patientId: a.patientId,
          appointmentId: a.id,
          collectionDate: date,
          legacy: true,
          amountCents: cents(p.amount || 0),
        });
      }
    return [...out, ...s.receipts].map((r) =>
      s.assignments?.["receipt:" + r.id]
        ? {
            ...r,
            shiftId: s.assignments["receipt:" + r.id].shiftId,
            manuallyAssigned: true,
          }
        : r,
    );
  }
  async function snapshot(cid: string, shift: any, s: any) {
    const apps = await rows("appointments", cid),
      allExpenses = (await rows("expenses", cid)).map((e: any) =>
        s.assignments?.["expense:" + e.id]
          ? { ...e, shiftId: s.assignments["expense:" + e.id].shiftId }
          : e,
      ),
      expenses = allExpenses.filter(
        (e: any) =>
          !e.deletedAt && e.type === "shift" && e.shiftId === shift.id,
      );
    const receipts = (await receiptProjection(cid, s)).filter(
      (p: any) => p.shiftId === shift.id,
    );
    const ambiguous =
      (await receiptProjection(cid, s)).some(
        (p: any) =>
          !p.shiftId && p.date === shift.date && cents(p.amount || 0) > 0,
      ) ||
      allExpenses.some(
        (e: any) =>
          !e.deletedAt &&
          e.type === "shift" &&
          !e.shiftId &&
          e.date === shift.date &&
          cents(e.amount || 0) > 0,
      );
    if (ambiguous)
      fail(
        "هناك دفعات قديمة بلا وردية محددة في يوم العمل، يلزم تسويتها قبل الإقفال",
      );
    const rev: any = {},
      exp: any = {};
    for (const p of receipts) {
      const m = method(p.paymentMethod);
      if (m !== "نقاط الولاء")
        rev[m] =
          (rev[m] || 0) +
          (p.kind === "refund" ? -1 : 1) * (p.amountCents ?? cents(p.amount));
    }
    for (const e of expenses) {
      const m = method(e.paymentMethod);
      exp[m] = (exp[m] || 0) + cents(e.amount || 0);
    }
    const paid = Object.values(rev).reduce(
      (n: number, v: any) => n + v,
      0,
    ) as number;
    const cash = rev["كاش"] || 0,
      cashExp = exp["كاش"] || 0;
    const visits = apps.filter(
      (a: any) => a.shiftId === shift.id && a.status === "completed",
    );
    return {
      receipts,
      expenses,
      appointments: apps.filter(
        (a: any) =>
          visits.some((v: any) => v.id === a.id) ||
          receipts.some((r: any) => r.appointmentId === a.id),
      ),
      dynamicRevenues: Object.fromEntries(
        Object.entries(rev).map(([k, v]: any) => [k, egp(v)]),
      ),
      dynamicExpenses: Object.fromEntries(
        Object.entries(exp).map(([k, v]: any) => [k, egp(v)]),
      ),
      totalRevenue: egp(paid),
      cashRevenue: egp(cash),
      cardRevenue: egp(rev["فيزا"] || 0),
      instapayRevenue: egp(rev["إنستاباي"] || 0),
      walletRevenue: egp(rev["محفظة"] || 0),
      remainingRevenue: egp(
        visits.reduce((n: number, a: any) => n + balance(a).remaining, 0),
      ),
      expensesTotal: egp(
        Object.values(exp).reduce((n: number, v: any) => n + v, 0) as number,
      ),
      cashExpenses: egp(cashExp),
      expectedCash: egp(cents(shift.startCash || 0) + cash - cashExp),
      completedCount: visits.length,
    };
  }
  async function run(cid: string, auth: any, body: any) {
    await ensure();
    return db.financeTransaction(cid, async () => {
      const who = await actor(auth, cid),
        s = await load(cid);
      const action = body.action;
      permission(auth, action);
      if (
        body.queuedBy &&
        body.queuedBy !==
          [auth.type, auth.clinicId || "", auth.staffId || ""].join(":")
      )
        fail("الطلب يخص حسابًا آخر", 403);
      const key = String(body.requestId || "");
      if (!key || key.length > 128)
        fail("يلزم معرف طلب صالح لمنع تكرار الحركة", 400);
      const signature = crypto
        .createHash("sha256")
        .update(JSON.stringify({ ...body, requestId: undefined }))
        .digest("hex");
      if (s.requests[key]?.voided)
        fail("الطلب مؤرشف بعد مراجعة المدير ولن ينفذ", 409);
      if (s.requests[key]) {
        if (s.requests[key].signature !== signature)
          fail("معرف الطلب مستخدم لعملية مختلفة");
        if (s.requests[key].recordRef) {
          const current = await get(
            s.requests[key].recordRef.table,
            s.requests[key].recordRef.id,
            cid,
          );
          if (body.table === "clinics")
            return Object.fromEntries(
              ["id", "updatedAt", ...Object.keys(body.data || {})].map((k) => [
                k,
                current?.[k],
              ]),
            );
          return current;
        }
        const previous = s.requests[key].result;
        if (previous?.appointment?.id)
          return {
            ...previous,
            appointment: await get(
              "appointments",
              previous.appointment.id,
              cid,
            ),
          };
        return previous;
      }
      let result: any;
      const now = new Date().toISOString();
      const captured =
        body.clientOccurredAt &&
        Number.isFinite(Date.parse(body.clientOccurredAt)) &&
        Date.parse(body.clientOccurredAt) <= Date.now() + 300000
          ? new Date(body.clientOccurredAt).toISOString()
          : now;

      if (who.clinic.isActive === false) fail("العيادة موقوفة", 403);
      if (action === "review_pending") {
        if (auth.type === "staff") fail("المراجعة المالية للمدير فقط", 403);
        const target = String(body.targetRequestId || "");
        if (!target || target === key || target.length > 128)
          fail("حدد الطلب الأصلي", 400);
        if (!String(body.reason || "").trim()) fail("سبب المراجعة مطلوب", 400);
        const existing = s.requests[target];
        if (existing && !existing.voided)
          result = {
            reviewState: "confirmed",
            originalResult: existing.result,
            targetRequestId: target,
          };
        else {
          s.requests[target] = {
            voided: true,
            reviewedBy: who.name,
            reviewedAt: now,
            reason: String(body.reason),
          };
          event(
            s,
            who,
            "pending_request_voided",
            { id: target },
            0,
            String(body.reason),
          );
          result = { reviewState: "voided", targetRequestId: target };
        }
      } else if (action === "assign_legacy") {
        const sh = await get("shifts", String(body.shiftId), cid);
        if (!sh || sh.status !== "open") fail("اختر وردية مفتوحة للتسوية");
        if (!String(body.reason || "").trim()) fail("سبب التسوية مطلوب", 400);
        const kind = body.sourceType;
        if (!["receipt", "expense"].includes(kind))
          fail("نوع تسوية غير صالح", 400);
        const source =
          kind === "receipt"
            ? (await receiptProjection(cid, s)).find(
                (r: any) => r.id === body.sourceId,
              )
            : await get("expenses", String(body.sourceId), cid);
        if (
          !source ||
          source.shiftId ||
          s.assignments?.[kind + ":" + source.id]
        )
          fail("الحركة غير متاحة للتسوية أو مرتبطة بالفعل");
        s.assignments ||= {};
        s.assignments[kind + ":" + source.id] = {
          shiftId: sh.id,
          reason: String(body.reason),
          actorName: who.name,
          createdAt: now,
        };
        event(
          s,
          who,
          "legacy_assigned",
          { ...source, id: source.id },
          cents(source.amount || 0),
          String(body.reason),
          { assignedShiftId: sh.id, sourceType: kind },
        );
        result = { success: true };
      } else if (action === "open") {
        if (await active(cid, false))
          fail("هناك وردية مفتوحة بالفعل، أقفلها يدويًا أولًا");
        const date = String(body.date || day(now));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("تاريخ غير صالح", 400);
        const shift = {
          id: crypto.randomUUID(),
          date,
          status: "open",
          cashierName: who.name,
          openedAt: now,
          startCash: egp(cents(body.startCash || 0)),
          notes: String(body.notes || ""),
        };
        result = await put("shifts", shift.id, cid, shift);
      } else if (action === "close") {
        const sh = await get("shifts", String(body.shiftId), cid);
        if (!sh || sh.status !== "open") fail("الوردية مقفولة أو غير موجودة");
        const snap = await snapshot(cid, sh, s),
          actual = egp(cents(body.actualCash));
        result = await put("shifts", sh.id, cid, {
          ...sh,
          ...snap,
          status: "closed",
          actualCash: actual,
          discrepancy: egp(cents(actual) - Math.round(snap.expectedCash * 100)),
          closedAt: now,
          closedBy: who.name,
          notes: String(body.notes || ""),
          snapshot: { ...snap, closedAt: now },
        });
      } else if (["collect", "points", "discount", "refund"].includes(action)) {
        const app = await get("appointments", String(body.appointmentId), cid);
        if (!app) fail("الموعد غير موجود", 404);
        if (app.status === "cancelled" && action !== "refund")
          fail("لا يمكن تحصيل موعد ملغي");
        const b = balance(app),
          amount = cents(body.amount);
        if (!amount) fail("المبلغ يجب أن يكون أكبر من صفر", 400);
        const shift = await active(cid);
        if (body.expectedShiftId && body.expectedShiftId !== shift.id)
          fail("الوردية تغيرت قبل المزامنة، يلزم مراجعة الحركة");
        const ps = payments(app);
        let newPaid = b.paid,
          newPrice = b.price;
        let payMethod = method(body.paymentMethod);
        if (action === "collect" && payMethod === "نقاط الولاء")
          fail("استخدم السداد بالنقاط للتحقق من المحفظة", 400);
        let points = 0;
        let earnedPoints = 0;
        let reversedPoints = 0;
        const patient = app.patientId
          ? await get("patients", app.patientId, cid)
          : null;
        if (action === "refund") {
          const original = (await receiptProjection(cid, s)).find(
            (r: any) =>
              r.id === body.receiptId &&
              r.appointmentId === app.id &&
              r.kind !== "refund",
          );
          if (!original) fail("حدد الإيصال الأصلي للاسترداد");
          const refunded = s.receipts
            .filter((r: any) => r.originalReceiptId === original.id)
            .reduce((n: number, r: any) => n + r.amountCents, 0);
          if (
            amount >
              (original.amountCents ?? cents(original.amount)) - refunded ||
            amount > b.paid
          )
            fail("الاسترداد أكبر من المتاح");
          if (!String(body.reason || "").trim())
            fail("سبب الاسترداد مطلوب", 400);
          newPaid -= amount;
          payMethod = method(original.paymentMethod);
          if (payMethod === "نقاط الولاء")
            fail("استرداد نقاط قديمة يحتاج تسوية معتمدة، لا يخرج نقدًا");
          // Use the award recorded at collection, never today's loyalty settings.
          // Older receipts can recover their award from the idempotent request result.
          const award = Number(original.loyaltyPointsEarned ??
            s.requests[original.requestId]?.result?.pointsChanged ?? 0);
          const originalAmount = original.amountCents ?? cents(original.amount);
          const alreadyReversed = s.receipts
            .filter((r: any) => r.originalReceiptId === original.id)
            .reduce((n: number, r: any) => n + Number(r.loyaltyPointsReversed || 0), 0);
          const totalReversal = Math.floor(Math.max(0, award) * (refunded + amount) / originalAmount);
          reversedPoints = Math.max(0, totalReversal - alreadyReversed);
          if (patient && reversedPoints > 0) {
            // A negative wallet is a points debt if the award was already spent.
            // Clamping to zero would allow payment/refund cycles to mint rewards.
            await put("patients", patient.id, cid, {
              loyaltyPoints: Number(patient.loyaltyPoints || 0) - reversedPoints,
              updatedAt: now,
            });
          }
          points = -reversedPoints;
        } else {
          if (amount > b.remaining) fail("المبلغ أكبر من المستحق الحالي");
          if (action === "discount") newPrice -= amount;
          else newPaid += amount;
        }
        if (action === "points") {
          if (!patient || who.clinic.loyaltyProgramEnabled === false)
            fail("محفظة النقاط غير متاحة");
          const threshold =
              Number(who.clinic.loyaltyRedeemPointsThreshold) || 1000,
            value = Number(who.clinic.loyaltyRedeemDiscountEgp) || 250;
          points = Math.ceil(((amount / 100) * threshold) / value);
          const min = Number(who.clinic.loyaltyMinRedeemPoints) || 0;
          if (points < min || points > Number(patient.loyaltyPoints || 0))
            fail("رصيد النقاط أو الحد الأدنى لا يسمح بالسداد");
          payMethod = "نقاط الولاء";
          await put("patients", patient.id, cid, {
            loyaltyPoints: Number(patient.loyaltyPoints || 0) - points,
            updatedAt: now,
          });
        } else if (
          action === "collect" &&
          patient &&
          who.clinic.loyaltyProgramEnabled !== false
        ) {
          const threshold =
              Number(who.clinic.loyaltyEarnEgpThreshold) > 0
                ? Number(who.clinic.loyaltyEarnEgpThreshold)
                : 100,
            earn =
              who.clinic.loyaltyEarnPoints === undefined
                ? 20
                : Math.max(0, Number(who.clinic.loyaltyEarnPoints) || 0);
          points = Math.floor(amount / 100 / threshold) * earn;
          earnedPoints = points;
          if (points > 0)
            await put("patients", patient.id, cid, {
              loyaltyPoints: Number(patient.loyaltyPoints || 0) + points,
              updatedAt: now,
            });
        }
        if (action === "discount" && !String(body.reason || "").trim())
          fail("سبب الخصم مطلوب", 400);
        if (action === "discount") {
          event(s, who, "discount", app, amount, String(body.reason || "خصم"));
        } else {
          const rec = {
            id: crypto.randomUUID(),
            receiptNumber: "R-" + crypto.randomUUID().toUpperCase(),
            kind: action === "refund" ? "refund" : "payment",
            amount: egp(amount),
            amountCents: amount,
            paymentMethod: payMethod,
            date: shift.date,
            collectionDate: day(captured),
            occurredAt: captured,
            confirmedAt: now,
            collectionTimeSource: body.clientOccurredAt ? "device" : "server",
            createdAt: captured,
            shiftId: shift.id,
            appointmentId: app.id,
            patientId: app.patientId,
            patientName: app.patientName,
            actorName: who.name,
            actorRole: who.role,
            requestId: key,
            originalReceiptId: body.receiptId || null,
            loyaltyPointsEarned: earnedPoints,
            loyaltyPointsReversed: reversedPoints,
            notes: String(body.reason || ""),
            type: action === "refund" ? "refund" : "installment",
          };
          s.receipts.push(rec);
          if (action !== "refund") ps.push(rec);
          else
            event(s, who, "refund", app, amount, String(body.reason), {
              receiptNumber: rec.receiptNumber,
              originalReceiptId: body.receiptId,
            });
          result = { receipt: rec };
        }
        const updated = await put("appointments", app.id, cid, {
          paidAmount: egp(newPaid),
          price: egp(newPrice),
          remainingAmount: egp(newPrice - newPaid),
          invoiceStatus:
            newPrice === newPaid
              ? "paid"
              : newPaid > 0
                ? "installment"
                : "pending_payment",
          payments: ps,
          paymentMethod: payMethod || app.paymentMethod,
          updatedAt: now,
        });
        // Keep original appointment shift ownership; each receipt owns its own shift.
        result = { ...result, appointment: updated, pointsChanged: points };
      } else if (action === "write") {
        const table = body.table;
        if (
          ![
            "appointments",
            "expenses",
            "lab_orders",
            "patients",
            "records",
            "billing",
            "clinics",
            ...contentTables,
          ].includes(table)
        )
          fail("عملية غير مدعومة", 400);
        const id = String(body.id || crypto.randomUUID()),
          old = await get(table, id, cid),
          data = { ...(body.data || {}) };
        if (body.create && old)
          fail("معرف السجل مستخدم بالفعل، يلزم مراجعة التعارض");
        if (old && body.base) {
          const fields = Object.entries(body.base)
            .filter(
              ([field, value]) =>
                !SERVER_METADATA.has(field) &&
                !sameValue(old[field], value) &&
                !sameValue(old[field], data[field]),
            )
            .map(([field]) => ({
              key: field,
              serverValue: old[field] ?? null,
              localValue: data[field] ?? null,
              serverEditor: old._fieldEdits?.[field] || null,
            }));
          if (fields.length) {
            const patient = old.patientId
              ? await get("patients", old.patientId, cid)
              : null;
            fail("تعارض تعديل، راجع القيمتين قبل الحسم", 409, {
              entityName:
                old.patientName ||
                patient?.name ||
                old.name ||
                old.title ||
                null,
              fields,
            });
          }
        }
        delete data._fieldEdits;
        delete data._syncStatus;
        for (const k of [
          "id",
          "clinicId",
          "clinicid",
          "clinic_id",
          "deletedAt",
          "cancelledAt",
          "cancelledBy",
          "actorName",
          "actorRole",
        ])
          delete data[k];
        if (auth.type === "staff") {
          const tab =
            table === "appointments"
              ? "calendar"
              : table === "patients"
                ? "patients"
                : table === "lab_orders"
                  ? "laboratory"
                  : contentTables.includes(table)
                    ? ["laboratories", "lab_work_types"].includes(table)
                      ? "laboratory"
                      : [
                            "custom_medications",
                            "custom_categories",
                            "prescriptions",
                          ].includes(table)
                        ? "prescriptions"
                        : "patients"
                    : "financials_expenses";
          if (
            !(auth.allowedTabs || []).includes(tab) &&
            !(auth.allowedTabs || []).includes("financials")
          )
            fail("لا توجد صلاحية لتعديل هذا السجل", 403);
        }
        if (["finance_state"].includes(table))
          fail("السجل لا يقبل التعديل", 403);
        if (table === "clinics") {
          if (auth.type === "staff" || id !== cid)
            fail("إعدادات العيادة للمدير فقط", 403);
          const allowed = new Set([
            "name",
            "nameAr",
            "nameEn",
            "logoUrl",
            "doctorName",
            "doctorNameEn",
            "doctorPhone",
            "additionalPhones",
            "doctorSpecialtyAr",
            "doctorSpecialtyEn",
            "clinicHours",
            "address",
            "prescriptionStyle",
            "prescriptionLayout",
            "customPrescriptionPadConfig",
            "consultationPrice",
            "bookingSystemMode",
            "questionnaireQuestions",
            "customDentalServices",
            "dentalServiceCategories",
            "paymentMethods",
            "dentalChartStyleSettings",
            "autoBackupEnabled",
            "autoBackupFormat",
            "loyaltyProgramEnabled",
            "loyaltyEarnEgpThreshold",
            "loyaltyEarnPoints",
            "loyaltyRedeemPointsThreshold",
            "loyaltyRedeemDiscountEgp",
            "loyaltyMinRedeemPoints",
            "updatedAt",
          ]);
          if (Object.keys(data).some((k) => !allowed.has(k)))
            fail("هذا الإعداد يتطلب الاتصال المباشر بالخادم", 403);
          if (
            data.bookingSystemMode &&
            old?.bookingSystemMode !== data.bookingSystemMode &&
            (await rows("appointments", cid)).some(
              (a) => a.status !== "cancelled",
            )
          )
            fail("لا يمكن تغيير نظام الحجز مع وجود مواعيد");
          await put(table, id, cid, { ...data, updatedAt: now });
          result = { ...data, id, updatedAt: now };
        } else if (table === "appointments") {
          if (
            old &&
            data.payments &&
            JSON.stringify(data.payments) !== JSON.stringify(old.payments || [])
          )
            fail("استخدم تسجيل تحصيل آمن بدل تعديل إيصالات محفوظة");
          if (
            old &&
            data.paidAmount !== undefined &&
            cents(data.paidAmount) !== cents(old.paidAmount || 0)
          )
            fail("استخدم تسجيل التحصيل لتغيير المدفوع");
          if (
            !old &&
            (cents(data.paidAmount || 0) > 0 || (data.payments || []).length)
          )
            fail("أنشئ الموعد أولًا ثم سجل الدفعة");
          if (old && old.paidAmount === undefined && Number(old.price) > 0)
            fail("موعد قديم بلا رصيد مدفوع صريح، راجع المدير دون تعديل تلقائي");
          const paid = cents(old?.paidAmount || 0),
            price = cents(data.price ?? old?.price ?? 0);
          if (old && price < cents(old.price || 0)) {
            permission(auth, "discount");
            event(
              s,
              who,
              "discount",
              old,
              cents(old.price || 0) - price,
              String(body.reason || "تعديل تكلفة الإجراء"),
            );
          }
          if (price < paid)
            fail("لا تقلل التكلفة عن المقبوض، استخدم تسوية صريحة");
          data.paidAmount = egp(paid);
          data.remainingAmount = egp(price - paid);
          data.invoiceStatus =
            price === paid && price > 0
              ? "paid"
              : paid > 0
                ? "installment"
                : price > 0
                  ? "pending_payment"
                  : "draft";
          data.payments = old?.payments || [];
          if (
            data.patientId &&
            !(await get("patients", data.patientId, cid)) &&
            !data.isPendingNewPatient
          )
            fail("سجل المريض غير موجود");
          if (
            old &&
            old.status !== "cancelled" &&
            data.status === "cancelled"
          ) {
            permission(auth, "delete");
            event(
              s,
              who,
              "appointment_cancelled",
              old,
              paid,
              String(body.reason || "إلغاء موعد"),
            );
          }
          if (old?.shiftId) data.shiftId = old.shiftId;
          else {
            const sh = await active(cid, false);
            data.shiftId = sh?.id || null;
          }
        } else if (table === "expenses") {
          permission(auth, "expense");
          if (old)
            fail("المصروف المسجل لا يعدل، استخدم إلغاء موثق ثم سجل الصحيح");
          data.amount = egp(cents(data.amount));
          if (!data.amount) fail("قيمة المصروف أكبر من صفر");
          if (data.type === "shift") {
            const sh = await active(cid);
            if (body.expectedShiftId && body.expectedShiftId !== sh.id)
              fail("الوردية تغيرت قبل مزامنة المصروف، يلزم مراجعة");
            data.shiftId = sh.id;
          } else {
            data.type = "personal";
            data.shiftId = null;
          }
          data.createdAt = now;
          data.actorName = who.name;
          data.paymentMethod = method(data.paymentMethod);
        } else if (table === "lab_orders") {
          if (
            old &&
            old.status !== "cancelled" &&
            data.status === "cancelled"
          ) {
            permission(auth, "delete");
            event(
              s,
              who,
              "lab_cancelled",
              old,
              cents(old?.paidAmount || 0),
              String(body.reason || "إلغاء طلب معمل"),
            );
          }
          const oldPaid = cents(old?.paidAmount || 0),
            newPaid = cents(data.paidAmount ?? old?.paidAmount ?? 0);
          if (newPaid > cents(data.cost ?? old?.cost ?? 0))
            fail("دفعة المعمل أكبر من التكلفة");
          if (newPaid < oldPaid)
            fail("تخفيض دفعة معمل ليس رد نقد تلقائيًا، يلزم تسوية منفصلة");
          if (newPaid > oldPaid) {
            const sh = await active(cid);
            if (body.expectedShiftId && body.expectedShiftId !== sh.id)
              fail("الوردية تغيرت قبل مزامنة دفعة المعمل، يلزم مراجعة");
            const expId = crypto.randomUUID();
            await put("expenses", expId, cid, {
              title:
                "دفعة معمل: " +
                (data.laboratoryName || old?.laboratoryName || id),
              amount: egp(newPaid - oldPaid),
              category: "مصاريف معامل",
              type: "shift",
              shiftId: sh.id,
              paymentMethod: method(data.paymentMethod || old?.paymentMethod),
              date: day(now),
              createdAt: now,
              labOrderId: id,
              actorName: who.name,
            });
          }
        } else if (contentTables.includes(table) || table === "billing") {
          const pid = data.patientId || old?.patientId;
          if (
            ["records", "prescriptions", "xrays", "teeth"].includes(table) &&
            (!pid || !(await get("patients", pid, cid)))
          )
            fail("سجل المريض غير موجود");
          if (table === "billing")
            fail("الفواتير المالية من الموعد والتحصيل الآمن فقط", 403);
          if (pid) data.patientId = pid;
        } else if (table === "patients") {
          if (!old && Number(data.loyaltyPoints || 0) !== 0)
            fail("رصيد افتتاحي للنقاط يحتاج تسوية معتمدة");
          if (
            old &&
            data.loyaltyPoints !== undefined &&
            Number(data.loyaltyPoints) !== Number(old.loyaltyPoints || 0)
          )
            fail("تعديل رصيد النقاط يدويًا غير مسموح");
        } else fail("عملية غير مدعومة", 400);
        const fieldEdits = { ...(old?._fieldEdits || {}) };
        for (const k of Object.keys(data))
          if (
            k !== "updatedAt" &&
            !sameValue(old?.[k], data[k])
          )
            fieldEdits[k] = {
              name: who.name,
              role: who.role,
              actorId: who.id,
              at: now,
            };
        if (table !== "clinics")
          result = await put(table, id, cid, {
            ...data,
            _fieldEdits: fieldEdits,
            updatedAt: now,
          });
        else await put(table, id, cid, { _fieldEdits: fieldEdits });
      } else if (action === "delete") {
        const table = body.table;
        if (
          ![
            "appointments",
            "expenses",
            "lab_orders",
            "patients",
            "records",
            "billing",
            ...contentTables,
          ].includes(table)
        )
          fail("الحذف غير مسموح", 403);
        const id = String(body.id),
          old = await get(table, id, cid);
        if (!old) fail("السجل غير موجود", 404);
        if (table === "patients") {
          const related =
            (await rows("appointments", cid)).some(
              (a: any) => a.patientId === id,
            ) ||
            (await rows("lab_orders", cid)).some(
              (a: any) => a.patientId === id,
            ) ||
            s.receipts.some((r: any) => r.patientId === id) ||
            s.events.some((r: any) => r.patientId === id) ||
            (await rows("billing", cid)).some((r: any) => r.patientId === id) ||
            (await rows("records", cid)).some((r: any) => r.patientId === id) ||
            (await rows("prescriptions", cid)).some(
              (r: any) => r.patientId === id,
            ) ||
            (await rows("xrays", cid)).some((r: any) => r.patientId === id) ||
            (await rows("teeth", cid)).some((r: any) => r.patientId === id);
          if (related)
            fail(
              "لا يمكن حذف المريض لأنه مرتبط بمواعيد أو معاملات أو سجل علاجي",
            );
          await db.execute({
            sql: "DELETE FROM patients WHERE id = ?",
            args: [id],
          });
          event(
            s,
            who,
            "patient_deleted",
            old,
            0,
            String(body.reason || "حذف مريض بلا سجل"),
          );
        } else if (table === "appointments") {
          if (old.status === "cancelled") fail("الموعد ملغي بالفعل");
          event(
            s,
            who,
            "appointment_cancelled",
            old,
            cents(old.paidAmount || 0),
            String(body.reason || "إلغاء موعد"),
          );
          await put(table, id, cid, {
            status: "cancelled",
            cancelledAt: now,
            cancelledBy: who.name,
          });
        } else if (table === "expenses") {
          if (old.deletedAt) fail("المصروف ملغي بالفعل");
          const sh = old.shiftId ? await get("shifts", old.shiftId, cid) : null;
          if (sh?.status === "closed")
            fail("مصروف وردية مقفولة لا يحذف، يلزم تسوية مستقلة");
          event(
            s,
            who,
            "expense_deleted",
            old,
            cents(old.amount || 0),
            String(body.reason || "إلغاء مصروف"),
          );
          await put(table, id, cid, { deletedAt: now, deletedBy: who.name });
        } else if (table === "lab_orders") {
          if (old.status === "cancelled") fail("طلب المعمل ملغي بالفعل");
          event(
            s,
            who,
            "lab_cancelled",
            old,
            cents(old.paidAmount || 0),
            String(body.reason || "إلغاء طلب معمل"),
          );
          await put(table, id, cid, {
            status: "cancelled",
            cancelledAt: now,
            cancelledBy: who.name,
          });
        } else if (contentTables.includes(table))
          await db.execute({
            sql: `DELETE FROM ${table} WHERE id = ?`,
            args: [id],
          });
        else fail("الحذف غير مسموح", 403);
        result = { success: true };
      } else fail("عملية غير معروفة", 400);
      s.requests[key] =
        action === "write"
          ? { signature, recordRef: { table: body.table, id: result.id } }
          : { signature, result };
      await save(cid, s);
      return result;
    });
  }
  async function handler(req: any, res: any) {
    try {
      const auth = await getAuth(req);
      if (!auth) fail("يلزم تسجيل الدخول", 401);
      const cid = String(req.body.clinicId || auth.clinicId || "");
      if (auth.type !== "admin" && cid !== auth.clinicId) fail("غير مصرح", 403);
      if (!cid) fail("حدد العيادة", 400);
      if (req.body.action === "inspect_pending") {
        if (auth.type === "staff") fail("المراجعة المالية للمدير فقط", 403);
        await actor(auth, cid);
        await ensure();
        const inspected = await db.financeTransaction(cid, async () => {
          const state = await load(cid),
            entry = state.requests[String(req.body.targetRequestId || "")],
            appointment = req.body.appointmentId
              ? await get("appointments", String(req.body.appointmentId), cid)
              : null;
          return {
            requestState: entry?.voided
              ? "voided"
              : entry
                ? "confirmed"
                : "not_confirmed",
            appointment,
            receipts: (await receiptProjection(cid, state)).filter(
              (r) =>
                req.body.appointmentId &&
                r.appointmentId === req.body.appointmentId,
            ),
          };
        });
        return res.json(inspected);
      }
      if (req.body.action === "read") {
        await actor(auth, cid);
        permission(auth, "read");
        await ensure();
        const result = await db.financeTransaction(cid, async () => {
          const s = await load(cid);
          return {
            events: s.events,
            receipts: await receiptProjection(cid, s),
            expenses: (await rows("expenses", cid)).map((e: any) =>
              s.assignments?.["expense:" + e.id]
                ? {
                    ...e,
                    shiftId: s.assignments["expense:" + e.id].shiftId,
                    manuallyAssigned: true,
                  }
                : e,
            ),
          };
        });
        return res.json(result);
      }
      const result = await run(cid, auth, req.body);
      if (req.body.table)
        broadcast(cid, {
          table: req.body.table,
          action: "finance",
          id: req.body.id,
        });
      broadcast(cid, { table: "patients", action: "finance" });
      broadcast(cid, { table: "appointments", action: "finance" });
      broadcast(cid, { table: "shifts", action: "finance" });
      broadcast(cid, { table: "expenses", action: "finance" });
      return res.json(result);
    } catch (e: any) {
      if (!e.status) console.error("[Finance] Transaction failed", e);
      res.status(e.status || 500).json({
        conflict: e.details,
        message: commandMessage(
          e.status
            ? e.message
            : "تعذر تأكيد العملية المالية، أعد المحاولة بنفس معرف الطلب",
          String(req.headers["accept-language"] || "").startsWith("en"),
        ),
      });
    }
  }
  return { handler, run };
}
