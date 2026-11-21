const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
(async () => {
  const base = process.env.TEST_BASE;
  const mode = process.env.TEST_DEV === '1' ? 'dev' : 'production';
  const auth = await fetch(base + '/api/superadmin/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email:'admin@crowndent.com',password:'admin123'}),
  }).then(r => r.json());
  assert(auth.token);
  const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({width:1440,height:1100});
    await page.evaluateOnNewDocument(token => {
      localStorage.setItem('dental_auth_token',token);
      localStorage.setItem('dental_saas_session',JSON.stringify({type:'admin'}));
      localStorage.setItem('i18nextLng','ar');
      localStorage.setItem('auto_backup_admin_last_date',new Date().toISOString().slice(0,10));
    },auth.token);
    await page.goto(base + '/login',{waitUntil:'networkidle2'});
    async function click(text) {
      await page.waitForFunction(t => [...document.querySelectorAll('button')].some(b => b.getClientRects().length && b.textContent.includes(t)),{},text);
      await page.evaluate(t => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes(t)).click(),text);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('المتابعة بوضع المحاكاة المحلي')));
    await click('المتابعة بوضع المحاكاة المحلي');
    await page.waitForFunction(() => !document.body.innerText.includes('لم يتم الحصول على الداتا بيز'));
    await click('الموقع التعريفي');
    await page.waitForFunction(() => [...document.querySelectorAll('label')].some(l => l.textContent === 'المميزات (سطر لكل ميزة)'));
    const copy = {};
    async function typeField(label,value,index=0) {
      await page.evaluate((label,index) => {
        document.querySelectorAll('[data-whitespace-test]').forEach(el => el.removeAttribute('data-whitespace-test'));
        const el = [...document.querySelectorAll('label')].filter(l => l.textContent === label)[index].parentElement.querySelector('textarea');
        if(!el) throw Error('Not a textarea: '+label);
        el.setAttribute('data-whitespace-test','');el.scrollIntoView({block:'center',behavior:'instant'});
      },label,index);
      await page.$eval('[data-whitespace-test]',el=>el.focus());

      await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      // Real individual key events catch trimming on every controlled-input update.
      for(const char of value) {
        if(char === '\n') await page.keyboard.press('Enter');
        else await page.keyboard.type(char);
      }
      assert.equal(await page.$eval('[data-whitespace-test]',el => el.value),value,label+' keeps every typed character');
    }
    const fields = [
      ['الوصف تحت العنوان','heroSubtitle',0],['وصف: المميزات','featuresSubtitle',0],
      ['وصف: الأسعار','pricingSubtitle',0],['وصف الـ CTA','ctaSubtitle',0],
      ['سطر الحقوق في الفوتر','footerCopyright',0],['وصف قصير','planDesc',0],
      ['الوصف','featureDesc',0],['الوصف','stepDesc',12],
    ];
    // There are eight feature descriptions and four stats labels before steps.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('label')].filter(l => l.textContent === 'الوصف').length),15);
    for(const lang of ['ar','en']) {
      if(lang === 'en') await click('English');
      copy[lang] = {};
      for(const [label,key,index] of fields) {
        const value = lang === 'ar' ? `  ${key}  مساحة   محفوظة\n\nسطر  جديد  ` : `  ${key}  extra   spaces\n\nA  new line  `;
        copy[lang][key] = value;
        await typeField(label,value,index);
      }
      const features = lang === 'ar' ? '  ملفات   المرضى  \n\nمواعيد  وتقارير\nسطر أخير  \n' : '  Patient   files  \n\nBooking  reports\nLast line  \n';
      copy[lang].features=features;
      await typeField('المميزات (سطر لكل ميزة)',features);
      await page.$eval('[data-whitespace-test]',el=>{el.scrollTop=0;el.scrollIntoView({block:'center',behavior:'instant'});});
      await page.screenshot({path:`/downloads/website-whitespace-${mode}-${lang}-editor.png`});
    }
    await click('حفظ التعديلات');
    await page.waitForFunction(() => document.body.innerText.includes('تم حفظ محتوى الموقع'));
    await click('حسناً');
    const stored = await fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'getDoc',path:'system_settings/landing_page',id:'landing_page'})}).then(r=>r.json());
    fs.writeFileSync(`/downloads/website-whitespace-${mode}-stored.json`,JSON.stringify(stored,null,2));
    const data=stored.data || stored;
    for(const lang of ['ar','en']) {
      assert.equal(data[lang].heroSubtitle,copy[lang].heroSubtitle);
      assert.deepEqual(data.plans[0][lang].features,copy[lang].features.split('\n'));
    }
    // A fresh unauthenticated visitor reads persisted content from the real API.
    const context = await browser.createBrowserContext();
    const visitor = await context.newPage();
    visitor.on('pageerror', e => errors.push(e.message));
    await visitor.setViewport({width:1440,height:1100});
    await visitor.goto(base,{waitUntil:'networkidle2'});
    for(const lang of ['ar','en']) {
      if(lang === 'en') await visitor.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('English')).click());
      for(const [key,value] of Object.entries(copy[lang])) {
        if(key === 'features') continue;
        await visitor.waitForFunction(v=>[...document.querySelectorAll('span')].some(el=>el.textContent===v),{},value);
        const result=await visitor.evaluate(value => {
          const el=[...document.querySelectorAll('span')].find(el=>el.textContent===value);
          const style=getComputedStyle(el);
          const r=document.createRange();r.selectNodeContents(el);
          return {whiteSpace:style.whiteSpace,lines:r.getClientRects().length,overflowWrap:style.overflowWrap};
        },value);
        assert.equal(result.whiteSpace,'break-spaces',key+' displays spaces and newlines');
        assert(result.lines>=3,key+' has visual line breaks');
        assert.equal(result.overflowWrap,'anywhere');
      }
      const list = await visitor.$$eval('#pricing ul',els=>[...els[0].querySelectorAll('li')].map(el=>el.textContent));
      assert.deepEqual(list,copy[lang].features.split('\n'),'list preserves blank lines and spacing');
      await visitor.$eval('#pricing',el=>el.scrollIntoView({block:'start',behavior:'instant'}));
      await visitor.screenshot({path:`/downloads/website-whitespace-${mode}-${lang}-public.png`});
      await visitor.setViewport({width:390,height:844});
      assert(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow on mobile');
      assert(await visitor.$eval('nav button:last-child',el=>el.getBoundingClientRect().height<52),'mobile login label stays readable');
      await visitor.$eval('#pricing',el=>el.scrollIntoView({block:'start',behavior:'instant'}));
      await visitor.screenshot({path:`/downloads/website-whitespace-${mode}-${lang}-mobile.png`});
      await visitor.setViewport({width:1440,height:1100});
    }
    await context.close();
    // Reload editor to check rehydration from saved JSON, including trailing Enter.
    await page.reload({waitUntil:'networkidle2'});
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('المتابعة بوضع المحاكاة المحلي')));
    await click('المتابعة بوضع المحاكاة المحلي');
    await click('الموقع التعريفي');
    await page.waitForFunction(v => [...document.querySelectorAll('textarea')].some(el=>el.value===v),{},copy.ar.features);
    await click('English');
    await page.waitForFunction(v => [...document.querySelectorAll('textarea')].some(el=>el.value===v),{},copy.en.features);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mode}: keyboard typing, API persistence, reload, AR/EN public rendering, blank/trailing lines, spaces, descriptions and mobile layout`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
