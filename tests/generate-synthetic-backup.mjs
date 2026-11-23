import crypto from 'node:crypto';
import fs from 'node:fs';

// Synthetic FULL_SYSTEM_BACKUP generator (load-test fixture; all ids prefixed syn_)
const N = parseInt(process.argv[2] || '200', 10);
const OUT = process.argv[3] || '/tmp/full-system-backup.json';
const PATIENTS = 1000, SHIFTS = 365, APPTS_PER_SHIFT = 20;
const hash = pw => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const H = hash('Test1234');
const t0 = Date.now();
let rows = 0;
const renewalsLog = [];
const w = fs.createWriteStream(OUT);
const iso = d => d.toISOString();
w.write('{"schemaVersion":3,"credentialSchemaVersion":1,"superadminCredentials":[],"platform":"CrownDent Multi-Tenant System Master","backupScope":"FULL_SYSTEM_BACKUP","backupTimestamp":' + JSON.stringify(new Date().toISOString()) + ',"totalClinicsCount":' + N + ',"clinics":[');
for (let c = 1; c <= N; c++) {
  const cid = 'syn_clinic_' + String(c).padStart(4, '0');
  const patients = [], appointments = [], shifts = [], prescriptions = [], receipts = [];
  for (let p = 1; p <= PATIENTS; p++) {
    const pid = cid + '_p' + p;
    patients.push({ id: pid, clinicId: cid, name: 'مريض تجريبي ' + c + '-' + p, phone: '010' + String(10000000 + c * 1000 + p).slice(0, 8), age: 20 + (p % 45), gender: p % 2 ? 'male' : 'female', medicalHistory: '', createdAt: iso(new Date(Date.UTC(2024, 11, p % 31 || 1))), synthetic: true });
    prescriptions.push({ id: cid + '_rx' + p, clinicId: cid, patientId: pid, patientName: patients[p - 1].name, date: '2025-06-15', medications: [{ name: 'Amoxicillin 500mg', dose: '500mg', frequency: '3 مرات يومياً', duration: '5 أيام' }], synthetic: true });
  }
  for (let s = 0; s < SHIFTS; s++) {
    const day = new Date(Date.UTC(2025, 0, 1 + s));
    const dateStr = day.toISOString().slice(0, 10);
    const sid = cid + '_s' + (s + 1);
    shifts.push({ id: sid, clinicId: cid, date: dateStr, status: 'closed', openedAt: iso(new Date(day.getTime() + 8 * 3600e3)), closedAt: iso(new Date(day.getTime() + 20 * 3600e3)), startCash: 0, expectedCash: 5000, actualCash: 5000, totalRevenue: 5000, appointmentsCount: APPTS_PER_SHIFT, synthetic: true });
    for (let a = 0; a < APPTS_PER_SHIFT; a++) {
      const pIdx = ((s * APPTS_PER_SHIFT + a) % PATIENTS) + 1;
      const pid = cid + '_p' + pIdx;
      const aid = cid + '_a' + (s * APPTS_PER_SHIFT + a + 1);
      appointments.push({ id: aid, clinicId: cid, patientId: pid, patientName: patients[pIdx - 1].name, date: dateStr, time: '10:00', status: 'completed', type: 'جلسة علاج', price: 500, paidAmount: 250, remainingAmount: 250, discount: 0, invoiceStatus: 'installment', procedure: 'جلسة علاج', notes: 'بيانات اختبار فقط', paymentMethod: 'كاش', payments: [{ id: aid + '_r', amount: 250, paymentMethod: 'كاش', date: dateStr, createdAt: iso(new Date(day.getTime() + 12 * 3600e3)), type: 'initial', shiftId: sid }], shiftId: sid, createdAt: iso(new Date(day.getTime() + 9 * 3600e3)), synthetic: true });
      receipts.push({ id: aid + '_r', clinicId: cid, patientId: pid, appointmentId: aid, shiftId: sid, amountCents: 25000, amount: 250, kind: 'payment', receiptNumber: aid + '_r', paymentMethod: 'كاش', patientName: patients[pIdx - 1].name, date: dateStr, collectionDate: dateStr, createdAt: iso(new Date(day.getTime() + 12 * 3600e3)), occurredAt: iso(new Date(day.getTime() + 12 * 3600e3)), synthetic: true });
    }
  }
  for (const shift of shifts) {
    const shiftApps = appointments.filter(a => a.shiftId === shift.id);
    const snap = { receipts: receipts.filter(r => r.shiftId === shift.id), appointments: shiftApps, expenses: [], dynamicRevenues: { 'كاش': 5000 }, dynamicExpenses: { 'كاش': 0 }, totalRevenue: 5000, cashRevenue: 5000, cardRevenue: 0, instapayRevenue: 0, walletRevenue: 0, remainingRevenue: 5000, expensesTotal: 0, cashExpenses: 0, expectedCash: 5000, completedCount: 20 };
    Object.assign(shift, snap, { actualCash: 5000, discrepancy: 0, closedBy: 'Synthetic', snapshot: { ...snap, closedAt: shift.closedAt } });
  }
  for (let m = 0; m < 12; m++) renewalsLog.push({ id: cid + '_renewal_' + (m+1), clinicId: cid, clinicName: 'عيادة اختبار ' + c, oldExpiry: new Date(Date.UTC(2025,m,1)).toISOString(), newExpiry: new Date(Date.UTC(2025,m+1,1)).toISOString(), renewedAt: new Date(Date.UTC(2025,m,1)).toISOString(), amount: 500, paymentMethod: 'كاش', notes: 'اشتراك شهري تجريبي', synthetic: true });
  rows += patients.length + appointments.length + shifts.length + prescriptions.length + receipts.length;
  const clinic = {
    credentialSchemaVersion: 1,
    clinicInfo: { id: cid, name: 'عيادة اختبار ' + c, email: 'syn' + c + '@example.invalid', password: H, staffPin: H, isActive: true, subscriptionExpiresAt: '2030-01-01', staffMembers: [
      { id: 'reception', name: 'موظف استقبال', role: 'استقبال / مساعد', password: H, allowedTabs: ['calendar'] },
      { id: 'doctor', name: 'طبيب', role: 'طبيب', password: H, allowedTabs: ['patients'] }], synthetic: true },
    patients, appointments, records: [], teeth: [], xrays: [], prescriptions, customMedications: [], customCategories: [], shifts,
    expenseList: [], inventory: [], billing: [], dailyClosings: [], labOrders: [], labWorkTypes: [],
    finance_state: { version: 1, receipts, events: [], requests: {} }
  };
  const json = (c > 1 ? ',' : '') + JSON.stringify(clinic);
  if (!w.write(json)) await new Promise(r => w.once('drain', r));
}
w.end('],"renewalsLog":' + JSON.stringify(renewalsLog) + ',"broadcasts":[],"systemSettings":[]}');
await new Promise(r => w.once('finish', r));
const bytes = fs.statSync(OUT).size;
console.log(JSON.stringify({ clinics: N, rows, bytes, mb: +(bytes / 1048576).toFixed(2), bytesPerClinic: Math.round(bytes / N), ms: Date.now() - t0 }));
