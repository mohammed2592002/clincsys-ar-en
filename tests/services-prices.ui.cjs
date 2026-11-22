const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const base = process.env.TEST_BASE;
const cid = 'finance_isolated_test';

const SERVICES = [
  { id: 's1', name: 'كشف واستشارة', price: 200, condition: 'healthy', category: 'عام' },
  { id: 's2', name: 'حشو ليزر تجميلي', price: 800, condition: 'filled', category: 'حشوات' },
  { id: 's3', name: 'حشو أطفال', price: 400, condition: 'filled', category: 'حشوات' },
  { id: 's4', name: 'تنظيف جير وتلميع', price: 350, condition: 'healthy', category: 'تنظيف وتلميع' },
  { id: 's5', name: 'خلع عادي', price: 300, condition: 'missing', category: 'جراحة وخلع' },
  { id: 's6', name: 'تلميع وتبييض', price: 500, condition: 'healthy', category: 'تنظيف وتلميع' },
  { id: 's7', name: 'حشو عصب كامل', price: 1500, condition: 'filled', category: 'حشوات' },
  { id: 's8', name: 'خلع جراحي', price: 600, condition: 'missing', category: 'جراحة وخلع' },
  { id: 's9', name: 'تلبيسة زيركون', price: 2500, condition: 'crown', category: 'تركيبات' },
  { id: 's10', name: 'تركيبة بورسلين', price: 1800, condition: 'crown', category: 'تركيبات' },
  { id: 's11', name: 'جسر خزفي 3 وحدات', price: 4500, condition: 'bridge', category: 'تركيبات' },
  { id: 's12', name: 'تقويم أسنان كامل', price: 8000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' },
];
const CATEGORIES = ['عام', 'حشوات', 'تنظيف وتلميع', 'جراحة وخلع', 'تركيبات', 'تقويم وتجميل الأسنان'];

(async () => {
  const login = await fetch(base + '/api/auth/clinic-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'finance-isolated@example.invalid', password: 'test-only-password', role: 'manager' }) }).then(r => r.json());
  const db = async (action, path, id, data) => {
    const r = await fetch(base + '/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify({ action, path, id, data }) });
    assert.equal(r.status, 200, await r.text());
  };
  await db('updateDoc', 'clinics/' + cid, cid, { customDentalServices: SERVICES, dentalServiceCategories: CATEGORIES });

  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1050 });
    await page.evaluateOnNewDocument((token, clinic) => {
      localStorage.setItem('dental_auth_token', token);
      localStorage.setItem('dental_saas_session', JSON.stringify({ type: 'clinic', clinicId: clinic.id, clinicName: clinic.name }));
      localStorage.setItem('auto_backup_last_date_' + clinic.id, new Date().toISOString().slice(0, 10));
      if (!localStorage.getItem('i18nextLng')) localStorage.setItem('i18nextLng', 'ar');
    }, login.token, login.clinic);

    const rows = () => page.$$eval('[data-testid="service-row"]', es => es.length);
    const counter = () => page.$eval('[data-testid="services-counter"]', e => e.textContent.trim());
    const clickText = async t => {
      const found = await page.evaluate(text => {
        const b = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim().includes(text));
        b?.click(); return !!b;
      }, t);
      assert.ok(found, 'Missing button ' + t);
    };
    const openSettingsTab = async (isEn) => {
      await clickText(isEn ? 'Settings' : 'الإعدادات');
      await page.waitForFunction((en) => [...document.querySelectorAll('button')].some(b => b.textContent.includes(en ? 'Prices & Services List' : 'قائمة الأسعار والخدمات')), {}, isEn);
      await clickText(isEn ? 'Prices & Services List' : 'قائمة الأسعار والخدمات');
      await page.waitForSelector('[data-testid="services-table"]');
    };
    const selectAll = async sel => {
      await page.click(sel);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
    };
    const typeSearch = async text => {
      const sel = '[data-testid="services-search"]';
      await selectAll(sel);
      if (text) await page.type(sel, text);
      await new Promise(r => setTimeout(r, 300));
    };

    await page.goto(base, { waitUntil: 'networkidle2' });
    await openSettingsTab(false);

    // --- Layout: header chips, tabs, single centered search, 5 rows ---
    assert.equal(await rows(), 5, 'initial 5 rows');
    assert.match(await counter(), /عرض 5 من 12 خدمة/);
    assert.equal(await page.$$eval('[data-testid="services-search"]', es => es.length), 1, 'exactly one search box');
    assert.ok(await page.$('[data-testid="add-service-header-btn"]'), 'header add button');
    assert.equal(await page.$eval('[data-testid="services-subtab-services"]', e => e.textContent), 'الخدمات (12)');
    assert.equal(await page.$eval('[data-testid="services-subtab-categories"]', e => e.textContent), 'الأقسام (6)');
    assert.ok(await page.evaluate(() => document.body.innerText.includes('12 خدمة') && document.body.innerText.includes('6 أقسام')), 'header count chips');
    assert.equal(await page.$eval('[data-testid="services-show-more"]', e => e.textContent.trim()), 'إظهار المزيد (5 خدمات)');
    // Search is horizontally centered in the services card
    const centered = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="services-search"]').getBoundingClientRect();
      const c = document.querySelector('[data-testid="services-table"]').getBoundingClientRect();
      return Math.abs((s.left + s.right) / 2 - (c.left + c.right) / 2);
    });
    assert.ok(centered <= 12, 'search centered, offset ' + centered);
    await page.screenshot({ path: '/downloads/services-prices-ar-desktop.png', fullPage: true });

    // --- Show more: +5 per click until exhausted ---
    await page.click('[data-testid="services-show-more"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 10);
    assert.match(await counter(), /عرض 10 من 12 خدمة/);
    await page.screenshot({ path: '/downloads/services-prices-ar-showmore.png', fullPage: true });
    await page.click('[data-testid="services-show-more"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 12);
    assert.equal(await page.$('[data-testid="services-show-more"]'), null, 'button hides at the end');
    assert.match(await counter(), /عرض 12 من 12 خدمة/);

    // --- Search covers ALL services, including ones not in the visible 5 ---
    await typeSearch('حشو');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 3);
    assert.match(await counter(), /عرض 3 من 3 خدمة/);
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="services-table"]').textContent.includes('حشو عصب كامل')), 'found service outside the visible 5');
    assert.equal(await page.$('[data-testid="services-show-more"]'), null, 'no show-more when all results fit');

    // --- Show-more pages within search results ---
    await typeSearch('ت');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 5);
    assert.match(await counter(), /عرض 5 من 10 خدمة/);
    await page.click('[data-testid="services-show-more"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 10);
    assert.match(await counter(), /عرض 10 من 10 خدمة/);
    await typeSearch('');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 5);
    assert.match(await counter(), /عرض 5 من 12 خدمة/);

    // --- Category filter chips ---
    await clickText('حشوات (3)');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 3);
    assert.match(await counter(), /عرض 3 من 3 خدمة/);
    await clickText('الكل (12)');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 5);

    // --- Inline price edit with autosave + saved tick ---
    const firstPrice = '[data-testid="service-row"] [data-testid="service-price-input"]';
    assert.equal(await page.$eval(firstPrice, e => e.value), '200');
    await selectAll(firstPrice);
    await page.type(firstPrice, '250');
    await page.keyboard.press('Tab');
    await page.waitForSelector('[data-testid="price-saved-tick"]');
    assert.match(await page.$eval('[data-testid="price-saved-tick"]', e => e.textContent), /تم الحفظ/);
    await page.screenshot({ path: '/downloads/services-prices-ar-inline-saved.png', fullPage: true });

    // --- Add service through the collapsible form ---
    await page.click('[data-testid="add-service-header-btn"]');
    await page.waitForSelector('[data-testid="service-form-panel"]');
    await page.type('[data-testid="service-form-panel"] input[type="text"]', 'خدمة اختبار جديدة');
    await selectAll('[data-testid="service-form-panel"] input[type="number"]');
    await page.type('[data-testid="service-form-panel"] input[type="number"]', '100');
    await clickText('حفظ');
    await page.waitForFunction(() => !document.querySelector('[data-testid="service-form-panel"]'), { timeout: 8000 });
    assert.ok(await page.evaluate(() => document.body.innerText.includes('13 خدمة')), 'chip updated to 13');
    assert.equal(await page.$eval('[data-testid="service-row"] td', e => e.textContent.trim()), 'خدمة اختبار جديدة', 'new service on top');

    // --- Pencil opens full edit; Cancel Edit closes ---
    await page.click('[data-testid="service-row"] button[title="تعديل الخدمة والسعر"]');
    await page.waitForSelector('[data-testid="service-form-panel"]');
    assert.equal(await page.$eval('[data-testid="service-form-panel"] input[type="text"]', e => e.value), 'خدمة اختبار جديدة', 'edit form populated');
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="service-form-panel"]').textContent.includes('تعديل بيانات الخدمة')), 'edit title');
    await clickText('إلغاء التعديل');
    await page.waitForFunction(() => !document.querySelector('[data-testid="service-form-panel"]'));

    // --- Delete with confirm dialog ---
    await page.click('[data-testid="service-row"] button[title="حذف الخدمة"]');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('نعم، متأكد')));
    await clickText('نعم، متأكد');
    await page.waitForFunction(() => document.body.innerText.includes('12 خدمة'), { timeout: 8000 });
    assert.equal(await page.$eval('[data-testid="service-row"] td', e => e.textContent.trim()), 'كشف واستشارة', 'deleted service gone from top');

    // --- Persistence of inline edit across reload ---
    await page.reload({ waitUntil: 'networkidle2' });
    await openSettingsTab(false);
    assert.equal(await page.$eval(firstPrice, e => e.value), '250', 'inline price persisted');

    // --- Categories tab: add / rename / delete ---
    await page.click('[data-testid="services-subtab-categories"]');
    await page.waitForSelector('[data-testid="categories-table"]');
    const catRows = () => page.$$eval('[data-testid="category-row"]', es => es.length);
    const catCounter = () => page.$eval('[data-testid="categories-counter"]', e => e.textContent.trim());
    const idle = () => page.waitForFunction(() => document.querySelector('[data-testid="services-settings"]').getAttribute('aria-busy') === 'false');
    assert.equal(await page.$$eval('[data-testid="categories-search"]', es => es.length), 1, 'one category search box');
    assert.equal(await catRows(), 5, 'categories: 5 rows initially');
    assert.match(await catCounter(), /عرض 5 من 6 أقسام/);
    await page.click('[data-testid="categories-show-more"]');
    assert.equal(await catRows(), 6);
    assert.equal(await page.$('[data-testid="categories-show-more"]'), null, 'show-more hidden at end');
    await page.screenshot({ path: '/downloads/categories-ar-desktop.png', fullPage: true });
    // add via header button + collapsible form
    await page.click('[data-testid="category-name-input"]');
    await page.type('[data-testid="category-name-input"]', 'قسم تجريبي');
    await page.click('[data-testid="category-add-submit"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="services-settings"]').getAttribute('aria-busy') === 'false' && document.body.innerText.includes('قسم تجريبي'));
    assert.equal(await catRows(), 7);
    // search across all categories (new one is beyond first 5)
    await page.type('[data-testid="categories-search"]', 'تجريبي');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await catRows(), 1, 'search finds category outside first 5');
    await page.evaluate(() => { const i = document.querySelector('[data-testid="categories-search"]'); i.focus(); });
    await selectAll('[data-testid="categories-search"]');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await catRows(), 5);
    // inline rename from the row
    await page.click('[data-testid="categories-show-more"]');
    await page.evaluate(() => { [...document.querySelectorAll('button[title="تعديل اسم القسم"]')].pop().click(); });
    await page.waitForSelector('[data-testid="category-rename-input"]');
    await selectAll('[data-testid="category-rename-input"]');
    await page.keyboard.type('قسم معدل');
    await page.screenshot({ path: '/downloads/categories-ar-rename.png', fullPage: true });
    await page.click('[data-testid="category-rename-save"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="services-settings"]').getAttribute('aria-busy') === 'false' && document.body.innerText.includes('قسم معدل'));
    // delete a category with services -> services move to عام
    await page.evaluate(() => { [...document.querySelectorAll('[data-testid="category-row"]')].find(r => r.textContent.includes('حشوات')).querySelector('button[title="حذف القسم"]').click(); });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('نعم، متأكد')));
    await clickText('نعم، متأكد');
    await page.waitForFunction(() => !document.body.innerText.includes('حشوات') || true);
    await idle();
    await page.reload({ waitUntil: 'networkidle2' });
    await openSettingsTab(false);
    await page.click('[data-testid="services-subtab-categories"]');
    await page.waitForSelector('[data-testid="categories-table"]');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-testid="category-row"]')].some(r => r.textContent.includes('حشوات'))), false, 'deleted category gone after reload');
    await page.click('[data-testid="services-subtab-services"]');
    await page.waitForSelector('[data-testid="services-table"]');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('عام')).click());
    await new Promise(r => setTimeout(r, 300));
    assert.ok((await rows()) >= 4, 'deleted category services moved to عام');
    await page.click('[data-testid="services-subtab-categories"]');
    // delete test category
    await page.evaluate(() => { [...document.querySelectorAll('[data-testid="category-row"]')].find(r => r.textContent.includes('تركيبات')) && 0; });
    await page.evaluate(() => { document.querySelector('[data-testid="categories-show-more"]')?.click(); });
    await page.evaluate(() => { [...document.querySelectorAll('[data-testid="category-row"]')].find(r => r.textContent.includes('قسم معدل')).querySelector('button[title="حذف القسم"]').click(); });
    await clickText('نعم، متأكد');
    await page.waitForFunction(() => !document.body.innerText.includes('قسم معدل'));
    await idle();

    await db('updateDoc', 'clinics/' + cid, cid, { customDentalServices: SERVICES, dentalServiceCategories: CATEGORIES });
    await page.evaluate(() => Object.keys(localStorage).filter(k => /categories|services/i.test(k)).forEach(k => localStorage.removeItem(k)));
    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => Object.keys(localStorage).filter(k => /categories|services/i.test(k)).forEach(k => localStorage.removeItem(k)));
    // --- English LTR ---
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
    await page.reload({ waitUntil: 'networkidle2' });
    await openSettingsTab(true);
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
    assert.equal(await page.$eval('[data-testid="services-subtab-services"]', e => e.textContent), 'Services (12)');
    assert.equal(await page.$eval('[data-testid="services-subtab-categories"]', e => e.textContent), 'Categories (6)');
    assert.match(await counter(), /Showing 5 of 12 services/);
    assert.equal(await page.$eval('[data-testid="services-show-more"]', e => e.textContent.trim()), 'Show more (5 services)');
    assert.ok(await page.evaluate(() => {
      const t = document.querySelector('[data-testid="services-table"]');
      return t.textContent.includes('Service') && t.textContent.includes('Price') && t.textContent.includes('EGP');
    }), 'English table labels');
    const centeredEn = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="services-search"]').getBoundingClientRect();
      const c = document.querySelector('[data-testid="services-table"]').getBoundingClientRect();
      return Math.abs((s.left + s.right) / 2 - (c.left + c.right) / 2);
    });
    assert.ok(centeredEn <= 12, 'search centered in LTR, offset ' + centeredEn);
    // inline edit works in English too
    await selectAll(firstPrice);
    await page.type(firstPrice, '275');
    await page.keyboard.press('Tab');
    await page.waitForSelector('[data-testid="price-saved-tick"]');
    assert.match(await page.$eval('[data-testid="price-saved-tick"]', e => e.textContent), /Saved/);
    await page.screenshot({ path: '/downloads/services-prices-en-desktop.png', fullPage: true });

    const waitIdle = () => page.waitForFunction(() => document.querySelector('[data-testid="services-settings"]').getAttribute('aria-busy') === 'false');
    // Repeat the actual service and category actions in English, including full edits.
    await typeSearch('حشو');
    assert.equal(await rows(), 3);
    await typeSearch('ت');
    assert.match(await counter(), /Showing 5 of 10/);
    await page.click('[data-testid="services-show-more"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="service-row"]').length === 10);
    assert.match(await counter(), /Showing 10 of 10/);
    await typeSearch('');
    await clickText('حشوات (3)');
    assert.equal(await rows(), 3);
    await clickText('All (12)');
    await page.click('[data-testid="add-service-header-btn"]');
    await page.type('[data-testid="service-form-panel"] input[type="text"]', 'English Test Service');
    await selectAll('[data-testid="service-form-panel"] input[type="number"]');
    await page.type('[data-testid="service-form-panel"] input[type="number"]', '123.5');
    await page.$$eval('[data-testid="service-form-panel"] select', els => { els[1].setAttribute('data-testid', 'condition-select'); });
    await page.select('[data-testid="condition-select"]', 'implant');
    await page.click('[data-testid="service-form-panel"] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="service-form-panel"]'));
    assert.match(await page.$eval('[data-testid="service-row"]', e => e.textContent), /English Test Service.*Implant/);
    await page.click('[data-testid="service-row"] button[title="Edit Service"]');
    await page.waitForSelector('[data-testid="service-form-panel"]');
    await selectAll('[data-testid="service-form-panel"] input[type="text"]');
    await page.type('[data-testid="service-form-panel"] input[type="text"]', 'Updated English Service');
    await page.$$eval('[data-testid="service-form-panel"] select', els => { els[1].setAttribute('data-testid', 'condition-select'); });
    await page.select('[data-testid="condition-select"]', 'crown');
    await page.click('[data-testid="service-form-panel"] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="service-form-panel"]'));
    assert.match(await page.$eval('[data-testid="service-row"]', e => e.textContent), /Updated English Service.*Crown/);
    await page.click('[data-testid="service-row"] button[title="Edit Service"]');
    await clickText('Cancel Edit');
    await page.click('[data-testid="service-row"] button[title="Delete Service"]');
    await clickText('Yes, delete');
    await waitIdle();
    await page.waitForFunction(() => !document.body.innerText.includes('Updated English Service'));
    await page.evaluate(() => document.querySelector('[data-testid="services-subtab-categories"]').click());
    await page.waitForSelector('[data-testid="categories-table"]');
    assert.match(await page.$eval('[data-testid="categories-counter"]', e => e.textContent.trim()), /Showing 5 of \d+ categories/);
    await page.screenshot({ path: '/downloads/categories-en-desktop.png', fullPage: true });
    await page.type('input[placeholder*="Orthodontics"]', 'English Category');
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="category-add-submit"]')].pop().click());
    await page.waitForFunction(() => !document.querySelector('input[placeholder*="Orthodontics"]').value);
    await page.type('[data-testid="categories-search"]', 'English');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await page.$$eval('[data-testid="category-row"]', es => es.length), 1, 'EN search over all categories');
    await page.evaluate(() => [...document.querySelectorAll('button[title="Edit Category"]')].pop().click());
    await selectAll('[data-testid="category-rename-input"]');
    await page.keyboard.type('Renamed Category');
    await page.click('[data-testid="category-rename-save"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="services-settings"]').getAttribute('aria-busy') === 'false' && !document.querySelector('[data-testid="category-rename-input"]'));
    await page.reload({ waitUntil: 'networkidle2' });
    await openSettingsTab(true);
    await page.click('[data-testid="services-subtab-categories"]');
    await page.type('[data-testid="categories-search"]', 'Renamed');
    await new Promise(r => setTimeout(r, 300));
    assert.ok(await page.evaluate(() => document.body.innerText.includes('Renamed Category')), 'category rename persists across reload');
    await page.evaluate(() => [...document.querySelectorAll('button[title="Delete Category"]')].pop().click());
    await clickText('Yes, delete');
    await page.waitForFunction(() => !document.body.innerText.includes('Renamed Category'));
    await page.click('[data-testid="services-subtab-services"]');
    await selectAll(firstPrice);
    await page.type(firstPrice, '-5');
    await page.keyboard.press('Tab');
    assert.equal(await page.$eval(firstPrice, e => e.value), '275', 'negative price resets without saving');
    await selectAll(firstPrice);
    await page.keyboard.press('Tab');
    assert.equal(await page.$eval(firstPrice, e => e.value), '275', 'blank price does not silently become zero');

    // Mobile remains scrollable within the table, without spilling the page.
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: '/downloads/services-prices-en-mobile.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page has no horizontal overflow');
    await page.setViewport({ width: 1440, height: 1050 });
    await new Promise(r => setTimeout(r, 62000)); // let the 300/min API limiter window reset
    await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
    await page.reload({ waitUntil: 'networkidle2' });
    await openSettingsTab(false);
    await page.click('[data-testid="service-row"] button[title="تعديل الخدمة والسعر"]');
    await page.waitForSelector('[data-testid="service-form-panel"]');
    await selectAll('[data-testid="service-form-panel"] input[type="text"]');
    await page.type('[data-testid="service-form-panel"] input[type="text"]', 'كشف واستشارة محدثة');
    await page.$$eval('[data-testid="service-form-panel"] select', els => { els[1].setAttribute('data-testid', 'condition-select'); });
    await page.select('[data-testid="condition-select"]', 'bridge');
    await page.click('[data-testid="service-form-panel"] button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="service-form-panel"]'));
    assert.match(await page.$eval('[data-testid="service-row"]', e => e.textContent), /كشف واستشارة محدثة.*جسر/);
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: '/downloads/services-prices-ar-mobile.png', fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Arabic mobile no horizontal page overflow');
    console.log('PASS additional English CRUD, full service edits + tooth condition in both languages, category persistence, negative/blank inline values, RTL/LTR mobile overflow checks.');

    // A rejected save must never claim that it succeeded.
    await page.setViewport({ width: 1440, height: 1050 });
    await new Promise(r => setTimeout(r, 2600));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const body = req.postData();
      if (req.url().endsWith('/api/finance') && body && JSON.parse(body).table === 'clinics') {
        return req.respond({status: 409, contentType: 'application/json', body: JSON.stringify({message: 'Test conflict, not saved'})});
      }
      return req.continue();
    });
    await selectAll(firstPrice);
    await page.type(firstPrice, '999');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.body.innerText.includes('Test conflict, not saved'));
    assert.equal(await page.$('[data-testid="price-saved-tick"]'), null, 'no false saved tick after rejection');
    await page.waitForFunction(() => document.querySelector('[data-testid="service-price-input"]').value === '275', { timeout: 3000 });
    assert.equal(await page.$eval(firstPrice, e => e.value), '275', 'failed price edit resets to confirmed value');
    console.log('PASS rejected inline save: visible error, no false success, original price retained.');

    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS services-prices redesign UI: 5-row pagination + show-more (+5, hides at end), search over all services, show-more inside search results, category chips, inline price autosave + tick + persistence, add via collapsible form, pencil edit + cancel, delete with confirm, categories add/rename/delete, English LTR mirrored with centered search, no uncaught browser errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
