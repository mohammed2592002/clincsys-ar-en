const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const base = process.env.TEST_BASE;
const cid = 'finance_isolated_test';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
(async () => {
  const login = await fetch(base + '/api/auth/clinic-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'finance-isolated@example.invalid', password: 'test-only-password', role: 'manager' }) }).then(r => r.json());
  const db = async (table, id, data) => {
    const r = await fetch(base + '/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ action: 'setDoc', path: `clinics/${cid}/${table}`, id, data }) });
    assert.equal(r.status, 200, await r.text());
  };
  await db('patients', 'lab-patient', { name: 'مريض تجربة المعمل', phone: '01000000000', age: 30 });
  await db('laboratories', 'test-lab', { name: 'معمل تجريبي', phone: '01000000000' });
  for (let i = 1; i <= 7; i++) {
    await db('appointments', 'lab-appt-' + i, { patientId: 'lab-patient', patientName: 'مريض تجربة ' + i, date: day(i - 1), time: '12:00', bookingType: 'turn', turnNumber: i, treatmentType: 'استكمال جلسات', status: 'scheduled', price: 100, paidAmount: 0 });
    await db('lab_orders', 'late-' + i, { patientId: 'lab-patient', patientName: 'مريض تجربة ' + i, laboratoryId: 'test-lab', laboratoryName: 'معمل تجريبي', appointmentId: i === 3 ? '' : 'lab-appt-' + i, appointmentDate: i === 3 ? '' : day(i - 1), workType: 'Zircon crown', toothNumbers: '16', status: 'sent', sentDate: day(-10), expectedDeliveryDate: day(-i), cost: 100, paymentStatus: 'unpaid', createdAt: day(-i) + 'T10:00:00Z' });
  }
  for (const [id, status, due, actual] of [['received', 'received', day(-2), ''], ['installed', 'installed', day(-2), ''], ['cancelled', 'cancelled', day(-2), ''], ['due-today', 'sent', today, ''], ['future', 'sent', day(1), ''], ['actual', 'sent', day(-2), today], ['no-date', 'sent', '', '']]) await db('lab_orders', id, { cost: 0, paymentStatus: 'unpaid', paidAmount: 0, patientName: 'Must not alert ' + id, status, expectedDeliveryDate: due, actualDeliveryDate: actual, createdAt: today });
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') console.log('BROWSER ERROR', m.text()); });
    await page.setViewport({ width: 1440, height: 1050 });
    await page.evaluateOnNewDocument((token, clinic) => {
      if (!localStorage.getItem('lab_test_initialized')) {
        localStorage.setItem('dental_auth_token', token);
        localStorage.setItem('dental_saas_session', JSON.stringify({ type: 'clinic', clinicId: clinic.id, clinicName: clinic.name }));
        localStorage.setItem('auto_backup_last_date_' + clinic.id, new Date().toISOString().slice(0,10)); localStorage.setItem('i18nextLng', 'ar'); localStorage.setItem('lab_test_initialized', '1');
      }
    }, login.token, login.clinic);
    const panel = '[data-testid="overdue-lab-panel"]';
    const rows = '[data-testid="overdue-lab-row"]';
    const clickText = async t => {
      const found = await page.evaluate(text => { const b = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes(text)); b?.click(); return !!b; }, t);
      assert(found, 'Missing button ' + t);
    };
    await page.goto(base, { waitUntil: 'networkidle2' });
    await page.waitForSelector(panel);
    assert.equal(await page.$$eval(rows, es => es.length), 3);
    assert((await page.$eval(panel, e => e.textContent)).includes('٧'));
    await page.screenshot({ path: '/downloads/lab-alerts-panel-ar.png', fullPage: true });
    await page.click('[data-testid="expand-lab-alerts"]');
    assert.equal(await page.$$eval(rows, es => es.length), 7);
    await page.click('[data-testid="expand-lab-alerts"]');
    // View order opens the exact selected order, not just the lab dashboard.
    await clickText('عرض الطلب');
    await page.waitForFunction(() => [...document.querySelectorAll('input')].some(e => e.value === 'Zircon crown') || document.body.innerText.includes('تعديل تفاصيل طلب المعمل')).catch(async e => { console.log('AFTER NAV', await page.evaluate(() => document.body.innerText), errors); await page.screenshot({path:'/downloads/lab-after-nav.png',fullPage:true}); throw e; });
    assert((await page.$$eval('input[type="date"]', es => es.map(e => e.value))).includes(day(-1)), 'Exact selected order due date');
    await page.screenshot({ path: '/downloads/lab-alerts-view-order.png', fullPage: true });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector(panel);
    await page.click('[data-testid="dismiss-lab-alerts"]');
    assert.equal(await page.$(panel), null);
    await page.reload({ waitUntil: 'networkidle2' });
    assert.equal(await page.$(panel), null);
    await page.screenshot({ path: '/downloads/lab-alerts-dismissed-ar.png', fullPage: true });
    // Old dismissal is expired on the next Cairo day.
    await page.evaluate((key, yesterday) => localStorage.setItem(key, yesterday), 'lab_alerts_dismissed_' + cid, day(-1));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector(panel);
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: '/downloads/lab-alerts-mobile-ar.png', fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
    await page.setViewport({ width: 1440, height: 1050 });
    await clickText('سجل المواعيد');
    await page.waitForSelector('[data-testid="appointment-lab-warning"]');
    assert.equal(await page.$$eval('[data-testid="appointment-lab-warning"]', es => es.length), 1);
    await page.screenshot({ path: '/downloads/lab-alerts-appointment-ar.png', fullPage: true });
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector(panel);
    assert.equal(await page.$eval(panel, e => e.dir), 'ltr');
    assert((await page.$eval(panel, e => e.textContent)).includes('Overdue lab orders'));
    await page.screenshot({ path: '/downloads/lab-alerts-panel-en.png', fullPage: true });
    await clickText('Appointments');
    await page.waitForSelector('[data-testid="appointment-lab-warning"]');
    assert((await page.$eval('[data-testid="appointment-lab-warning"]', e => e.textContent)).includes('Lab work overdue'));
    await page.screenshot({ path: '/downloads/lab-alerts-appointment-en.png', fullPage: true });
    // Receiving an order clears its warning and reduces the home count after sync.
    await db('lab_orders', 'late-1', { cost: 100, paymentStatus: 'unpaid', patientName: 'مريض تجربة 1', appointmentId: 'lab-appt-1', status: 'received', expectedDeliveryDate: day(-1), createdAt: today });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'lab_orders' } })));
    await page.waitForFunction(() => !document.querySelector('[data-testid="appointment-lab-warning"]'));
    await clickText('Patients');
    await page.waitForSelector(panel);
    await page.waitForFunction(() => document.querySelector('[data-testid="overdue-lab-panel"]').textContent.includes('(6)'));
    // The one-order layout has no expansion footer; no active overdue orders means no panel.
    for (let i = 2; i <= 6; i++) await db('lab_orders', 'late-' + i, { cost: 0, status: 'received', createdAt: today });
    await page.evaluate(() => { localStorage.setItem('i18nextLng', 'ar'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector(panel);
    assert.equal(await page.$$eval(rows, es => es.length), 1);
    assert.equal(await page.$('[data-testid="expand-lab-alerts"]'), null);
    await page.hover('[data-testid="dismiss-lab-alerts"]');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="lab-dismiss-tooltip"]')).opacity) > 0.9);
    await page.screenshot({path: '/downloads/lab-alerts-single-ar.png', fullPage: true});
    await db('lab_orders', 'late-7', { cost: 0, status: 'received', createdAt: today });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('clinic-sync', {detail:{table:'lab_orders'}})));
    await page.waitForFunction(() => !document.querySelector('[data-testid="overdue-lab-panel"]'));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS lab alerts UI: 7 overdue only; excluded completed/cancelled/today/future/actual/missing; 3+expand; exact order navigation; dismissal persists; expires next day; mobile no overflow; Arabic and English panel + appointment; receipt clears warning live; single/zero states; tooltip; no uncaught browser errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
