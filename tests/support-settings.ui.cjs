const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async () => {
  const base = process.env.TEST_BASE;
  const login = await fetch(base + '/api/auth/clinic-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'finance-isolated@example.invalid', password: 'test-only-password', role: 'manager' }),
  }).then(r => r.json());
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument((token, c) => {
      localStorage.setItem('dental_auth_token', token);
      localStorage.setItem('dental_saas_session', JSON.stringify({ type: 'clinic', clinicId: c.id, clinicName: c.name }));
      localStorage.setItem('i18nextLng', 'ar');
      localStorage.setItem('auto_backup_last_date_' + c.id, new Date().toISOString().slice(0, 10));
    }, login.token, login.clinic);
    await page.setRequestInterception(true);
    page.on('request', req => {
      let body;
      try { body = JSON.parse(req.postData() || '{}'); } catch {}
      if (req.url().endsWith('/api/db') && body?.path?.startsWith('system_settings') && body?.id === 'support' && body.action === 'getDoc') {
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'support', trialPhoneNumber: '01011112222', phoneNumbers: [{ id: 'fixture', title: 'دعم فني اختباري', phone: '01033334444' }], socialLinks: [{ id: 'fixture-web', platform: 'website', title: 'موقع الدعم الاختباري', url: 'https://example.invalid/support' }], workingHoursNotice: 'مواعيد خدمة اختبارية' }) });
      } else req.continue();
    });
    await page.goto(base, { waitUntil: 'networkidle2' });
    async function click(text) {
      await page.waitForFunction(t => [...document.querySelectorAll('button')].some(b => b.getClientRects().length && b.textContent.includes(t)), {}, text);
      await page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes(t)).click(), text);
    }
    await click('الإعدادات');
    await click('الدعم الفني والتواصل');
    await page.waitForFunction(() => document.body.innerText.includes('01033334444'));
    const expectBox = process.env.EXPECT_TRIAL_BOX === '1';
    const text = await page.evaluate(() => document.body.innerText);
    assert.equal(text.includes('رقم الواتساب لطلب النسخة التجريبية'), expectBox);
    assert.equal(text.includes('حفظ الرقم'), expectBox);
    assert.equal(await page.$$eval('input[type="tel"]', nodes => nodes.filter(n => n.getClientRects().length).length), expectBox ? 1 : 0);
    assert(text.includes('قسم الدعم الفني والتواصل المباشر'));
    assert(text.includes('دعم فني اختباري'));
    assert(text.includes('موقع الدعم الاختباري'));
    assert(text.includes('مواعيد خدمة اختبارية'));
    assert.equal(await page.$eval('a[href^="tel:"]', a => a.getAttribute('href')), 'tel:01033334444');
    assert.equal(await page.$eval('a[href="https://example.invalid/support"]', a => a.getAttribute('target')), '_blank');
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewport(viewport);
      await page.screenshot({ path: '/downloads/trial-box-' + (expectBox ? 'before' : 'after') + '-' + name + '.png', fullPage: true });
    }
    console.log('PASS trial settings box ' + (expectBox ? 'present before removal' : 'absent after removal') + '; support contacts, call link, social link, clinic header and hours intact');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
