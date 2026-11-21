const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const base = process.env.TEST_BASE;
  const mode = process.env.TEST_DEV === '1' ? 'dev' : 'production';
  const auth = await fetch(base + '/api/superadmin/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: 'admin@crowndent.com', password: 'admin123'}),
  }).then(r => r.json());
  assert(auth.token, 'isolated superadmin login');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const errors = [], navigations = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('framenavigated', f => {if (f === page.mainFrame()) navigations.push(f.url());});
    await page.setViewport({width: 1440, height: 1100});
    await page.evaluateOnNewDocument(token => {
      localStorage.setItem('dental_auth_token', token);
      localStorage.setItem('dental_saas_session', JSON.stringify({type: 'admin'}));
      localStorage.setItem('i18nextLng', 'ar');
      localStorage.setItem('auto_backup_admin_last_date', new Date().toISOString().slice(0, 10));
    }, auth.token);
    await page.goto(base + '/login', {waitUntil: 'networkidle2'});
    async function click(text) {
      await page.waitForFunction(t => [...document.querySelectorAll('button')].some(b => b.getClientRects().length && b.textContent.includes(t)), {}, text);
      await page.evaluate(t => {
        const b = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes(t));
        b.scrollIntoView({block: 'center'}); b.click();
      }, text);
    }
    await sleep(1500);
    if (await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('المتابعة')))) await click('المتابعة');
    const cases = [
      {tab: 'الموقع التعريفي', marker: 'الهوية واللوجو', name: 'website', selector: '[data-admin-save-test]', label: 'اسم البراند', id: 'landing_page', value: 'CoreDentSys UI regression'},
      {tab: 'الدعم الفني والهوية', marker: 'تنويه ساعات العمل والدعم', name: 'support', selector: '[data-admin-save-test]', label: 'تنويه ساعات العمل والدعم:', id: 'support', value: 'ساعات الدعم الاختبارية'},
    ];
    for (const test of cases) {
      await click(test.tab);
      await page.waitForFunction(t => document.body.innerText.includes(t), {}, test.marker);
      await page.waitForFunction(label => [...document.querySelectorAll('label')].some(el => el.textContent.trim() === label), {}, test.label);
      await page.evaluate(label => {
        document.querySelectorAll('[data-admin-save-test]').forEach(el => el.removeAttribute('data-admin-save-test'));
        [...document.querySelectorAll('label')].find(el => el.textContent.trim() === label).parentElement.querySelector('input,textarea').setAttribute('data-admin-save-test', '');
      }, test.label);
      await page.waitForSelector(test.selector);
      await page.$eval(test.selector, (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
      }, test.value);
      await page.evaluate(() => {
        window.__adminMain = document.querySelector('main');
        window.__syncCount = 0;
        window.addEventListener('clinic-sync', () => window.__syncCount++);
      });
      const navigationCount = navigations.length;
      const confirmed = page.waitForResponse(r => {
        if (!r.url().endsWith('/api/db')) return false;
        try {const b = JSON.parse(r.request().postData()); return b.action === 'setDoc' && b.id === test.id;} catch {return false;}
      });
      await click('حفظ');
      assert.equal((await confirmed).status(), 200);
      await page.waitForFunction(() => document.body.innerText.includes('تم حفظ'));
      // Cover local sync, WebSocket updates, and the dashboard's 15s refresh.
      await sleep(16000);
      assert.equal(navigations.length, navigationCount, 'save must not reload the page');
      assert(await page.evaluate(() => window.__adminMain === document.querySelector('main')), 'dashboard must not remount');
      assert(await page.evaluate(() => window.__syncCount > 0), 'real sync event received');
      assert(await page.evaluate(t => document.body.innerText.includes(t), test.marker), 'selected tab retained');
      assert(await page.evaluate(() => document.body.innerText.includes('تم حفظ')), 'confirmation stays until dismissed');
      const stored = await fetch(base + '/api/db', {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token},
        body: JSON.stringify({action: 'getDoc', path: 'system_settings/' + test.id, id: test.id}),
      }).then(r => r.json());
      assert(JSON.stringify(stored).includes(test.value), 'edited value persisted on server');
      await page.screenshot({path: '/downloads/admin-save-' + mode + '-' + test.name + '.png'});
      await click('حسناً');
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'حسناً'));
      assert.equal(await page.$eval(test.selector, el => el.value), test.value, 'saved field stays in editor');
      console.log('PASS ' + mode + ' ' + test.name + ': persisted edit, no reload/remount, same tab and visible confirmation after sync + 15s refresh');
    }
    const extra = {id: 'custom_settings', nested: {text: "نص O'Brien\nمع سطر جديد", list: ['🦷', 0, false, null]}};
    const seeded = await fetch(base + '/api/db', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token},
      body: JSON.stringify({action: 'setDoc', path: 'system_settings/custom_settings', id: 'custom_settings', data: extra}),
    });
    assert.equal(seeded.status, 200);
    await click('النسخ الاحتياطي والاستعادة');
    await click('SQL Dump (.sql)');
    await page.evaluate(() => {
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {window.__downloadBlob = blob; return original(blob);};
    });
    await page.click('#btn-download-full-system-backup');
    await page.waitForFunction(() => !!window.__downloadBlob);
    const sql = await page.evaluate(() => window.__downloadBlob.text());
    require('node:fs').writeFileSync('/downloads/admin-backup-' + mode + '.sql', sql);
    const checked = require('node:child_process').spawnSync('python3', ['-c',
      'import sys,sqlite3,json; c=sqlite3.connect(":memory:"); c.executescript(sys.stdin.read()); print(json.dumps({row[0]:json.loads(row[1]) for row in c.execute("SELECT id,data FROM system_settings")}))'
    ], {input: sql, encoding: 'utf8'});
    assert.equal(checked.status, 0, checked.stderr);
    const docs = JSON.parse(checked.stdout);
    assert.equal(docs.landing_page.ar.brandName, cases[0].value);
    assert.equal(docs.support.workingHoursNotice, cases[1].value);
    assert.deepEqual(docs.custom_settings.nested, extra.nested);
    assert(!docs.auth_secret);
    assert(!sql.includes('auth_secret'));
    await page.waitForFunction(() => document.body.innerText.includes('تم استخراج نسخة احتياطية شاملة'));
    await page.screenshot({path: '/downloads/admin-backup-' + mode + '.png'});
    console.log('PASS ' + mode + ' real SQL export: whole dump executes in SQLite; website/support/custom JSON intact; auth_secret absent');
    assert.deepEqual(errors, []);
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
