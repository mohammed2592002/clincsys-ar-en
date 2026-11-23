const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const base = process.env.TEST_BASE || "http://localhost:3100";
let alternate = 0;
let token,
  cid = "finance_isolated_test";
async function call(path, body, t = token) {
  const r = await fetch(
    (process.env.TEST_SECOND_BASE && path === "/api/finance" && alternate++ % 2
      ? process.env.TEST_SECOND_BASE
      : base) + path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { Authorization: "Bearer " + t } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return { status: r.status, data };
}
async function fin(body, expected = 200, t = token) {
  const r = await call(
    "/api/finance",
    { clinicId: cid, requestId: crypto.randomUUID(), ...body },
    t,
  );
  assert.equal(r.status, expected, JSON.stringify(r.data));
  return r.data;
}
async function db(action, table, id, data, expected = 200) {
  const r = await call("/api/db", {
    action,
    path: `clinics/${cid}/${table}`,
    id,
    data,
  });
  assert.equal(r.status, expected, JSON.stringify(r.data));
  return r.data;
}
(async () => {
  const login = await call(
    "/api/auth/clinic-login",
    {
      email: "finance-isolated@example.invalid",
      password: "test-only-password",
      role: "manager",
    },
    "",
  );
  assert.equal(login.status, 200);
  token = login.data.token;
  await db("setDoc", "patients", "p1", {
    name: "مريض اختبار محلي",
    loyaltyPoints: 0,
  });
  await db("setDoc", "appointments", "a1", {
    patientId: "p1",
    patientName: "مريض اختبار محلي",
    date: "2026-11-21",
    time: "10:00",
    price: 500,
    status: "completed",
    paidAmount: 0,
  });
  const opened = await Promise.all([
    call("/api/finance", {
      clinicId: cid,
      action: "open",
      date: "2026-11-20",
      startCash: 50,
      requestId: "open-race-1",
    }),
    call("/api/finance", {
      clinicId: cid,
      action: "open",
      date: "2026-11-20",
      startCash: 50,
      requestId: "open-race-2",
    }),
  ]);
  assert.deepEqual(opened.map((r) => r.status).sort(), [200, 409]);
  const opening = opened.find((r) => r.status === 200).data;

  await fin({ action: "open", startCash: 0 }, 409);
  const [r1, r2] = await Promise.all([
    fin({
      action: "collect",
      appointmentId: "a1",
      amount: 175,
      paymentMethod: "cash",
    }),
    fin({
      action: "collect",
      appointmentId: "a1",
      amount: 125,
      paymentMethod: "cash",
    }),
  ]);
  let app = await db("getDoc", "appointments", "a1");
  assert.equal(app.paidAmount, 300);
  assert.equal(app.remainingAmount, 200);
  assert.equal(app.payments.length, 2);
  assert.equal(r1.receipt.date, "2026-11-20");
  assert.notEqual(r1.receipt.collectionDate, r1.receipt.date);
  assert.equal(r1.receipt.actorName, "دكتور الاختبار");
  const body = {
    action: "collect",
    appointmentId: "a1",
    amount: 50,
    paymentMethod: "cash",
    requestId: "exact-request-key",
  };
  const a = await fin(body),
    b = await fin(body);
  assert.equal(a.receipt.id, b.receipt.id);
  await fin({ ...body, amount: 51 }, 409);
  app = await db("getDoc", "appointments", "a1");
  assert.equal(app.paidAmount, 350);
  assert.equal(app.payments.length, 3);
  await fin({ action: "collect", appointmentId: "a1", paymentMethod:"cash", amount: 151 }, 409);
  await fin(
    {
      action: "collect",
      appointmentId: "a1",
      amount: 1,
      paymentMethod: "نقاط الولاء",
    },
    400,
  );
  await db(
    "updateDoc",
    "appointments",
    "a1",
    { paidAmount: 999, remainingAmount: -499 },
    409,
  );
  await fin(
    { action: "write", table: "appointments; SELECT 1", id: "x", data: {} },
    400,
  );
  await fin({ action: "delete", table: "finance_state", id: cid }, 403);
  await fin({ action: "delete", table: "patients", id: "p1" }, 409);
  await db("setDoc", "patients", "empty", { name: "فارغ" });
  await fin({ action: "delete", table: "patients", id: "empty" });
  await db("setDoc", "patients", "race_patient", { name: "اختبار تعارض" });
  const race = await Promise.all([
    call("/api/finance", {
      clinicId: cid,
      action: "delete",
      table: "patients",
      id: "race_patient",
      requestId: "delete-race",
    }),
    call("/api/finance", {
      clinicId: cid,
      action: "write",
      table: "appointments",
      id: "race_app",
      requestId: "appointment-race",
      data: {
        patientId: "race_patient",
        price: 0,
        paidAmount: 0,
        status: "scheduled",
      },
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const staffToken =
    "v1." +
    Buffer.from(
      JSON.stringify({
        type: "staff",
        clinicId: cid,
        staffId: "staff1",
        staffName: "مزور",
        allowedTabs: ["financials"],
        exp: Date.now() + 100000,
      }),
    ).toString("base64url");
  const staff =
    staffToken +
    "." +
    crypto
      .createHmac("sha256", process.env.AUTH_SECRET)
      .update(staffToken.split(".")[1])
      .digest("base64url");
  await fin(
    {
      action: "refund",
      appointmentId: "a1",
      receiptId: a.receipt.id,
      amount: 10,
      reason: "اختبار",
    },
    403,
    staff,
  );
  await fin({ action: "collect", appointmentId: "a1", amount: 10 }, 403, staff);
  const points = await db("getDoc", "patients", "p1");
  assert.equal(points.loyaltyPoints, 40);
  await fin({ action: "points", appointmentId: "a1", amount: 20 });
  await db("updateDoc","appointments","a1",{paymentMethod:"نقاط الولاء",notes:"metadata after points payment"});
  await fin({
    action: "discount",
    appointmentId: "a1",
    amount: 10,
    reason: "خصم اختبار",
  });
  app = await db("getDoc", "appointments", "a1");
  assert.equal(app.paidAmount, 370);
  assert.equal(app.price, 490);
  assert.equal(app.remainingAmount, 120);
  await fin({
    action: "refund",
    appointmentId: "a1",
    receiptId: a.receipt.id,
    amount: 20,
    reason: "رد فعلي اختباري",
  });
  await fin(
    {
      action: "refund",
      appointmentId: "a1",
      receiptId: a.receipt.id,
      amount: 31,
      reason: "فوق المتاح",
    },
    409,
  );
  await fin({
    action: "write",
    table: "lab_orders",
    id: "lab1",
    data: {
      patientId: "p1",
      patientName: "مريض اختبار محلي",
      cost: 100,
      paymentMethod: "cash",
      paidAmount: 30,
      status: "sent",
    },
  });
  await fin({
    action: "delete",
    table: "lab_orders",
    id: "lab1",
    reason: "إلغاء بلا رد نقد",
  });
  await fin({
    action: "delete",
    table: "appointments",
    id: "a1",
    reason: "إلغاء بلا رد نقد",
  });
  let ledger = await fin({ action: "read" });
  assert.equal(ledger.receipts.filter((r) => r.kind === "refund").length, 1);
  assert.equal(
    ledger.events.filter((e) => e.type === "appointment_cancelled").length,
    1,
  );
  assert.equal(
    ledger.events.filter((e) => e.type === "lab_cancelled").length,
    1,
  );
  const expenses = await db("getDocs", "expenses");
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].amount, 30);
  const closed = await fin({
    action: "close",
    shiftId: opening.id,
    actualCash: 350,
  });
  assert.equal(closed.expectedCash, 350);
  assert.equal(closed.snapshot.totalRevenue, 330);
  assert.equal(closed.snapshot.cashExpenses, 30);
  await fin({ action: "close", shiftId: opening.id, actualCash: 350 }, 409);
  await fin(
    {
      action: "write",
      table: "shifts",
      id: opening.id,
      data: { actualCash: 0 },
    },
    400,
  );
  await fin({ action: "delete", table: "expenses", id: expenses[0].id }, 409);
  await fin({ action: "collect", appointmentId: "a1", amount: 10 }, 409);
  const saved = await db("getDoc", "shifts", opening.id);
  await db("updateDoc", "appointments", "a1", { price: 600 });
  const immutable = await db("getDoc", "shifts", opening.id);
  assert.deepEqual(immutable.snapshot, saved.snapshot);
  await fin({ action: "open", date: "2026-11-21", startCash: 0 });
  ledger = await fin({ action: "read" });
  assert.equal(ledger.receipts.length, 5);
  await db("setDoc", "records", "medical1", {
    patientId: "p1",
    notes: "اختبار",
  });
  await fin({ action: "delete", table: "patients", id: "p1" }, 409);
  await fin(
    {
      action: "assign_legacy",
      sourceType: "receipt",
      sourceId: a.receipt.id,
      shiftId: opening.id,
      reason: "غير مسموح",
    },
    409,
  );
  const fullLedger=await fin({action:'read'});
  for(const scope of ['shift','revenues','expenses','history','installments','returns','settlement','patient']) {
    const view=await fin({action:'view',scope,patientId:'p1',shiftId:opening.id,date:'2001-01-01',from:'2001-01-01',to:'2001-01-01'});
    assert(Array.isArray(view.receipts)&&Array.isArray(view.appointments));
    assert(!Object.hasOwn(view,'requests'));
    if(scope==='revenues')assert(view.receipts.every(r=>(r.collectionDate||r.date)==='2001-01-01'));
    if(scope==='history')assert.equal(view.receipts.length,0);
    if(scope==='patient')assert(view.appointments.every(a=>a.patientId==='p1'));
  }
  await fin({action:'view',scope:'invalid'},400);
  await fin({action:'view',scope:'revenues',from:'invalid'},400);
  console.log('PASS scoped finance views: patient isolation, period filtering, history without receipts, validation, no requests payload');
  console.log(
    "PASS: concurrent collection; idempotent retry/signature conflict; overpay/stale write rejection; SQL whitelist; actual actor/current staff permissions; patient history deletion block; points/discount; explicit refund; cancellation without refund; atomic lab expense; close snapshot; closed immutability; old shift operational date vs Cairo collection day.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
