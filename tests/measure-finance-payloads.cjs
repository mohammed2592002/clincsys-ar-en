// Payload measurement for the scoped finance views, matching the load-test
// report's method: decoded response body byte length per request. Runs against
// an isolated seeded fixture (synthetic data only) via run-finance-paging.mjs
// with TEST_SERVER_BUNDLE pointing at the server build under test.
// Usage: TEST_MAIN_ENTRY=tests/measure-finance-payloads.cjs TEST_SERVER_BUNDLE=<bundle> node tests/run-finance-paging.mjs
const crypto = require('node:crypto');
const base = process.env.TEST_BASE;
const cid = 'finance_isolated_test';
let token;
async function call(path, body) {
  const r = await fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: JSON.stringify(body)});
  return {status: r.status, data: await r.json().catch(() => ({}))};
}
async function finCall(body) {
  for (let a = 0; a < 8; a++) {
    const r = await call('/api/finance', {clinicId: cid, requestId: crypto.randomUUID(), ...body});
    if (r.status !== 429) return r;
    await new Promise(res => setTimeout(res, (Number(r.data.retryAfterSeconds) || 5) * 1000 + 500));
  }
  throw Error('persistent rate limit');
}
async function measure(label, body) {
  const r = await fetch(base + '/api/finance', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body: JSON.stringify({clinicId: cid, requestId: crypto.randomUUID(), ...body})});
  const text = await r.text();if(label==='shift-light-limit0')console.log('LIGHT BODY: '+text.slice(0,300));
  console.log('MEASURE ' + label + ' status=' + r.status + ' decodedBytes=' + Buffer.byteLength(text));
  return JSON.parse(text);
}
(async () => {
  const login = await call('/api/auth/clinic-login', {email: 'finance-isolated@example.invalid', password: 'test-only-password', role: 'manager'});
  if (login.status !== 200) throw Error('login failed');
  token = login.data.token;
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Cairo'});
  const opening = await finCall({action: 'open', date: today, startCash: 0});const shiftId = opening.data.id;
  if (opening.status !== 200) throw Error('open shift failed: ' + JSON.stringify(opening.data));

  // 600 patients, 2000 appointments on the shift day (synthetic fixture).
  const created = new Date().toISOString();
  const patientIds = [];
  for (let k = 0; k < 12; k++) patientIds.push('mp' + k);
  const pace=()=>new Promise(r=>setTimeout(r,2000));
  const seed=async(table,id,data)=>{const r=await call('/api/db',{action:'setDoc',path:`clinics/${cid}/${table}`,id,data});if(r.status!==200)throw Error('seed '+table+' '+id+' failed: '+JSON.stringify(r.data));};
  for (let c = 0; c < patientIds.length; c += 150) {if(c)await pace();
    await Promise.all(patientIds.slice(c, c + 150).map((pid, i) =>
      seed('patients', pid, {name: 'مريض قياس ' + (c + i), phone: '01000002' + String(1000 + c + i), loyaltyPoints: 0})));
  }
  const appIds = [];
  for (let i = 0; i < 80; i++) {
    const pid = patientIds[i % patientIds.length];
    const status = i % 10 < 8 ? 'completed' : i % 10 < 9 ? 'scheduled' : 'cancelled';
    appIds.push({id: 'ma' + i, data: {
      patientId: pid, patientName: 'مريض قياس ' + (i % patientIds.length), patientPhone: '01000002' + String(1000 + (i % patientIds.length)),
      date: today, time: String(9 + (i % 9)).padStart(2, '0') + ':' + (i % 2 ? '00' : '30'),
      treatmentType: 'حشو عصب وتنظيف عميق للأسنان', price: 500, paidAmount: 0,
      remainingAmount: status === 'completed' ? 250 + (i % 50) : 0,
      status, notes: 'ملاحظة قياس الأداء للحجز رقم ' + i + ' مع تفاصيل إضافية عن الجلسة والخطة العلاجية', createdAt: created, updatedAt: created,
    }});
  }
  for (let c = 0; c < appIds.length; c += 150) {await pace();
    await Promise.all(appIds.slice(c, c + 150).map(a => seed('appointments', a.id, a.data)));
  }
  // Real collections produce receipt rows linked to the open shift.
  for (let i = 0; i < 5; i++) {
    const r = await finCall({action: 'collect', appointmentId: 'ma' + i, amount: 100, paymentMethod: 'كاش'});
    if (r.status !== 200) throw Error('collect failed: ' + JSON.stringify(r.data));
  }
  console.log('SEEDED appointments=80 patients=12 receipts=5 date=' + today);

  await measure('shift-legacy-full', {action: 'view', scope: 'shift', shiftId, date: today});
  await measure('shift-legacy-full-repeat', {action: 'view', scope: 'shift', shiftId, date: today});
  const light = await measure('shift-light-limit0', {action: 'view', scope: 'shift', shiftId, date: today, limit: 0});
  await measure('installments-legacy-full', {action: 'view', scope: 'installments', from: '', to: ''});
  await measure('installments-paged-limit5', {action: 'view', scope: 'installments', from: '', to: '', limit: 5, search: ''});
  if (light.shiftTotals) console.log('shiftTotals=' + JSON.stringify(light.shiftTotals));
  console.log('MEASURE DONE');
})().catch(e => {console.error(e); process.exit(1);});
