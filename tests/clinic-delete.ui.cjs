// Superadmin clinic deletion: the deleted row must leave the table without a page reload.
// A delayed deleteDoc request reproduces the real ordering where the refresh read can
// overtake the server delete. The row must still disappear once deletion completes.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const base = process.env.TEST_BASE;
  const lang = process.env.TEST_LANG === 'en' ? 'en' : 'ar';
  const clinicId = 'probe-clinic-delete-1';
  const clinicName = 'Probe Clinic';
  const auth = await fetch(base + '/api/superadmin/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: 'admin@crowndent.com', password: 'admin123'}),
  }).then(r => r.json());
  assert(auth.token, 'isolated superadmin login');
  const headers = {'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token};

  const seed = await fetch(base + '/api/db', {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'setDoc', path: 'clinics/' + clinicId, id: clinicId,
      data: {
        name: clinicName, nameAr: 'عيادة الاختبار', nameEn: clinicName,
        doctorName: 'Dr Probe', doctorPhone: '', address: '',
        email: 'probe@example.com', isActive: true,
        createdAt: '2026-11-20T10:00:00.000Z',
        subscriptionExpiresAt: '2027-01-01T00:00',
        prescriptionStyle: 'classic', staffPin: '1234', staffMembers: [],
        allowedFeatures: ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'],
      },
    }),
  });
  assert(seed.ok, 'seeded probe clinic');

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({width: 1440, height: 1100});

    // Delay only the clinic deleteDoc call so the refresh read overtakes the server
    // delete, the exact ordering that left the stale row behind on the live demo.
    let deleteDone = false;
    await page.setRequestInterception(true);
    page.on('request', req => {
      try {
        if (req.method() === 'POST' && req.url().endsWith('/api/db')) {
          const body = JSON.parse(req.postData() || '{}');
          if (body.action === 'deleteDoc' && String(body.path || '').startsWith('clinics/')) {
            setTimeout(() => req.continue().catch(() => {}), 1200);
            return;
          }
        }
        req.continue().catch(() => {});
      } catch { req.continue().catch(() => {}); }
    });
    page.on('response', res => {
      try {
        if (res.request().method() === 'POST' && res.url().endsWith('/api/db')) {
          const body = JSON.parse(res.request().postData() || '{}');
          if (body.action === 'deleteDoc' && String(body.path || '').startsWith('clinics/')) deleteDone = true;
        }
      } catch {}
    });

    await page.evaluateOnNewDocument((token, lng) => {
      localStorage.setItem('dental_auth_token', token);
      localStorage.setItem('dental_saas_session', JSON.stringify({type: 'admin'}));
      localStorage.setItem('i18nextLng', lng);
      localStorage.setItem('auto_backup_admin_last_date', new Date().toISOString().slice(0, 10));
    }, auth.token, lang);
    await page.goto(base + '/login', {waitUntil: 'networkidle2'});
    await sleep(1500);
    if (await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('المتابعة')))) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('المتابعة'));
        b.click();
      });
    }

    const rowVisible = () => page.evaluate(name =>
      [...document.querySelectorAll('tr')].some(tr => tr.getClientRects().length && tr.innerText.includes(name)), clinicName);

    await page.waitForFunction(name =>
      [...document.querySelectorAll('tr')].some(tr => tr.getClientRects().length && tr.innerText.includes(name)), {}, clinicName);
    await page.screenshot({path: `/downloads/clinic-delete-${lang}-1-row-present.png`});

    // Delete through the real UI: row trash button, then the confirm dialog.
    await page.evaluate(name => {
      const tr = [...document.querySelectorAll('tr')].find(tr => tr.getClientRects().length && tr.innerText.includes(name));
      tr.querySelector('button[title="حذف العيادة نهائياً"]').click();
    }, clinicName);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.getClientRects().length && b.textContent.includes('نعم، متأكد')));
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes('نعم، متأكد')).click();
    });

    // Success dialog appears; dismiss it.
    await page.waitForFunction(() => document.body.innerText.includes('تم حذف العيادة نهائياً'));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && (b.textContent.trim() === 'حسناً' || b.textContent.trim() === 'OK'));
      if (b) b.click();
    });

    // Wait until the (delayed) server delete fully landed, then give any refresh time to finish.
    for (let i = 0; i < 100 && !deleteDone; i++) await sleep(100);
    assert(deleteDone, 'delete request completed');
    await sleep(2500);

    const serverDoc = await fetch(base + '/api/db', {
      method: 'POST', headers,
      body: JSON.stringify({action: 'getDoc', path: 'clinics/' + clinicId, id: clinicId}),
    }).then(r => r.json());
    assert(serverDoc === null || serverDoc.exists === false, 'server doc is gone');

    const stillThere = await rowVisible();
    await page.screenshot({path: `/downloads/clinic-delete-${lang}-2-after-delete.png`});
    assert.equal(stillThere, false, `[${lang}] deleted clinic row must leave the table without a page reload`);
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`PASS ${lang}: deleted clinic row disappears right after deletion; no reload, no page errors.`);
  } finally {
    await browser.close();
  }
  console.log('Isolated test passed. No real clinic data was used or changed.');
})().catch(err => { console.error(err.message || err); process.exit(1); });
