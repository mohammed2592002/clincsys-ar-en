// Scoped finance views: shift/installments pagination, server totals parity, and
// old-client compatibility. Self-seeded isolated fixture; no real clinic data.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const base = process.env.TEST_BASE;
let token;
const cid = 'finance_isolated_test';
async function call(path, body) {
  const r = await fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: JSON.stringify(body)});
  return {status: r.status, data: await r.json().catch(() => ({}))};
}
async function fin(body, expected = 200) {
  const r = await call('/api/finance', {clinicId: cid, requestId: crypto.randomUUID(), ...body});
  assert.equal(r.status, expected, JSON.stringify(r.data));
  return r.data;
}
async function db(action, table, id, data) {
  const r = await call('/api/db', {action, path: `clinics/${cid}/${table}`, id, data});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const sortView = list => [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.time || '').localeCompare(String(a.time || '')));
(async () => {
  const login = await call('/api/auth/clinic-login', {email: 'finance-isolated@example.invalid', password: 'test-only-password', role: 'manager'});
  assert.equal(login.status, 200);
  token = login.data.token;
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Cairo'});

  const opening = await fin({action: 'open', date: today, startCash: 0});
  const created = new Date().toISOString();
  for (let k = 0; k < 10; k++) await db('setDoc', 'patients', 'pp' + k, {name: 'مريض ' + k, phone: '010000001' + String(100 + k), loyaltyPoints: 0});
  // 40 appointments: 30 completed (20 with remaining), 6 scheduled, 4 cancelled, 10 patients.
  for (let i = 0; i < 40; i++) {
    const status = i < 30 ? 'completed' : i < 36 ? 'scheduled' : 'cancelled';
    const remaining = status === 'completed' && i < 20 ? 100 + i : 0;
    await db('setDoc', 'appointments', 'pa' + i, {
      patientId: 'pp' + (i % 10), patientName: 'مريض ' + (i % 10), patientPhone: '010000001' + String(100 + (i % 10)),
      date: today, time: String(10 + (i % 8)).padStart(2, '0') + ':' + (i % 2 ? '00' : '30'),
      treatmentType: 'حشو', price: 500, paidAmount: 0, remainingAmount: remaining,
      status, notes: 'ملاحظة ' + i, createdAt: created, updatedAt: created,
    });
  }
  // Three real collections link three appointments to the open shift's receipts.
  for (const i of [0, 1, 2]) await fin({action: 'collect', appointmentId: 'pa' + i, amount: 10, paymentMethod: 'كاش'});

  // Reference: legacy full view, no pagination params (old-client shape).
  const full = await fin({action: 'view', scope: 'shift', shiftId: opening.id, date: today});
  assert.equal(full.appointments.length, 40, 'full shift view keeps every matching appointment');
  assert(full.shiftTotals, 'full shift view also carries totals');
  const ref = {
    total: full.appointments.length,
    completed: full.appointments.filter(a => a.status === 'completed').length,
    scheduled: full.appointments.filter(a => a.status === 'scheduled').length,
    cancelled: full.appointments.filter(a => a.status === 'cancelled').length,
    remainingTotal: full.appointments.filter(a => a.status === 'completed').reduce((s, a) => s + Number(a.remainingAmount ?? 0), 0),
  };
  assert.deepEqual(full.shiftTotals, ref, 'server totals match the complete set');
  assert.equal(ref.completed, 30); assert.equal(ref.scheduled, 6); assert.equal(ref.cancelled, 4);

  // Light view: zero pages requested, receipt-linked appointments travel trimmed
  // to the fields the collections list renders; the client loads a full row on
  // demand for invoice printing.
  const light = await fin({action: 'view', scope: 'shift', shiftId: opening.id, date: today, limit: 0});
  assert.deepEqual(light.shiftTotals, ref, 'light view totals equal full-set totals');
  assert.equal(light.receipts.length, full.receipts.length, 'same receipts');
  assert.equal(light.appointments.length, 3, 'only receipt-linked appointment rows travel');
  const trimmedFields = ['id', 'patientId', 'patientName', 'patientPhone', 'date', 'time', 'status', 'price', 'paidAmount', 'remainingAmount', 'paymentMethod', 'invoiceStatus', 'treatmentType', 'shiftId', '__trimmed'];
  for (const a of light.appointments) {
    assert(['pa0', 'pa1', 'pa2'].includes(a.id));
    assert.equal(a.__trimmed, true, 'light rows carry the trimmed marker');
    for (const key of ['patientName', 'price', 'remainingAmount', 'treatmentType', 'date', 'time', 'status', 'paymentMethod']) assert(a[key] !== undefined, 'rendering field kept: ' + key);
    assert(!Object.hasOwn(a, 'notes'), 'heavy fields stay behind the on-demand read');
    assert(!Object.hasOwn(a, 'data'), 'no serialized envelope duplication');
    assert.deepEqual(Object.keys(a).sort(), trimmedFields.slice().sort(), 'trimmed row carries exactly the rendering fields');
  }
  // The on-demand full-row read behind invoice printing returns every field.
  const fullRow = await db('getDoc', 'appointments', 'pa0');
  assert.equal(fullRow.notes, 'ملاحظة 0', 'full row read returns every field');

  // Paged view: page rows follow the same ordering as the client list, plus linked rows.
  const sorted = sortView(full.appointments);
  const page = await fin({action: 'view', scope: 'shift', shiftId: opening.id, date: today, limit: 5, offset: 0});
  assert.deepEqual(page.shiftTotals, ref);
  const pageIds = page.appointments.map(a => a.id);
  for (const a of sorted.slice(0, 5)) assert(pageIds.includes(a.id), 'page row present');
  for (const id of ['pa0', 'pa1', 'pa2']) assert(pageIds.includes(id), 'linked row present in paged mode');
  for (const a of page.appointments) { assert(!a.__trimmed, 'paged mode keeps full rows'); assert(Object.hasOwn(a, 'notes'), 'paged rows keep every field'); }
  const page2 = await fin({action: 'view', scope: 'shift', shiftId: opening.id, date: today, limit: 5, offset: 5});
  for (const a of sorted.slice(5, 10)) assert(page2.appointments.map(x => x.id).includes(a.id), 'second page row present');

  // Installments: legacy full mode unchanged.
  const instFull = await fin({action: 'view', scope: 'installments', from: '', to: ''});
  assert(!Object.hasOwn(instFull, 'installmentGroups'), 'legacy installments view unchanged');
  const dues = instFull.appointments.filter(a => a.status === 'completed' && Number(a.remainingAmount ?? 0) > 0);
  assert.equal(dues.length, 30, 'every completed appointment carries a remaining balance');

  // Reference grouping mirrors the tab: key patientId||phone||name, sorted by totalRemaining desc.
  const map = new Map();
  for (const a of sortView(dues)) {
    const key = a.patientId || a.patientPhone || a.patientName;
    if (!map.has(key)) map.set(key, {patientId: a.patientId, patientName: a.patientName, patientPhone: a.patientPhone, totalRemaining: 0, totalPaid: 0, totalPrice: 0, appointments: []});
    const g = map.get(key);
    g.totalRemaining += Number(a.remainingAmount ?? 0);
    g.totalPaid += a.paidAmount !== undefined ? Number(a.paidAmount) : Number(a.price) || 0;
    g.totalPrice += Number(a.price) || 0;
    g.appointments.push(a);
  }

  const refGroups = [...map.values()].sort((a, b) => b.totalRemaining - a.totalRemaining);
  assert.equal(refGroups.length, 10, 'ten patients carry dues');

  const instPaged = await fin({action: 'view', scope: 'installments', from: '', to: '', limit: 5, offset: 0, search: ''});
  assert.equal(instPaged.installmentGroups.length, 5, 'first page of five groups');
  assert.deepEqual(instPaged.installmentTotals, {
    groupCount: refGroups.length,
    totalRemaining: refGroups.reduce((s, g) => s + g.totalRemaining, 0),
    totalPaid: refGroups.reduce((s, g) => s + g.totalPaid, 0),
    totalPrice: refGroups.reduce((s, g) => s + g.totalPrice, 0),
  }, 'installment totals cover the complete set');
  for (let i = 0; i < 5; i++) {
    assert.equal(instPaged.installmentGroups[i].patientId, refGroups[i].patientId, 'group order matches');
    assert.equal(instPaged.installmentGroups[i].totalRemaining, refGroups[i].totalRemaining, 'group total matches');
    assert.equal(instPaged.installmentGroups[i].appointments.length, refGroups[i].appointments.length, 'group keeps full rows');
  }
  assert.equal(instPaged.appointments.length, 0, 'rows travel once, inside their group, so paged responses do not duplicate them');
  const instPage2 = await fin({action: 'view', scope: 'installments', from: '', to: '', limit: 5, offset: 5, search: ''});
  assert.deepEqual(instPage2.installmentGroups.map(g => g.patientId), refGroups.slice(5, 10).map(g => g.patientId), 'second group page');
  const searched = await fin({action: 'view', scope: 'installments', from: '', to: '', limit: 5, offset: 0, search: 'مريض 3'});
  assert.equal(searched.installmentGroups.length, 1, 'name search narrows groups');
  assert.equal(searched.installmentGroups[0].patientId, 'pp3');
  const phoneSearch = await fin({action: 'view', scope: 'installments', from: '', to: '', limit: 5, offset: 0, search: '010000001103'});
  assert.equal(phoneSearch.installmentGroups.length, 1, 'phone search narrows groups');

  console.log('PASS: shift light/paged views keep exact totals and full linked rows; installments grouped pages, search and totals match the legacy full view; legacy shapes unchanged.');
})().catch(e => { console.error(e); process.exitCode = 1; });
