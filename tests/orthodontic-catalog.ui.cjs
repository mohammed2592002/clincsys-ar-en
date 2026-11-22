const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const base = process.env.TEST_BASE;
const cid = 'finance_isolated_test';
const lang = process.env.TEST_LANG || 'ar';
const legacy = process.env.TEST_EXISTING === '1';
const label = lang + (legacy ? '-legacy' : '');
const en = lang === 'en';
const names = en ? ['Specific Teeth Orthodontics','Full Orthodontic Braces (Both Arches)','Metal Braces (Single Arch)','Clear Aligners (Invisalign)','Orthodontic Adjustment Session','Debonding & Retainer Installation'] : ['تقويم أسنان محددة','تركيب تقويم أسنان كامل (فكين)','تركيب تقويم معدني علوي/سفلي','تقويم شفاف تجميلي (Invisalign)','جلسة شد ومعايرة تقويم','فك وإزالة تقويم وتثبيت'];
if (legacy) names[1] = en ? 'Full Braces (Both Arches)' : 'تركيب تقويم أسنان (كامل/فكين)';
const cat = en ? 'Orthodontics & Aesthetics' : 'تقويم وتجميل الأسنان';
const renamed = en ? 'Custom Orthodontic Plan' : 'خطة تقويم معدلة';
(async () => {
  const watchdog=setTimeout(()=>{console.error('UI watchdog: test exceeded 110 seconds');process.exit(1);},110000);
  console.log('START '+label);
  const login = await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());
  assert(login.token);
  const db = async(action,path,id,data)=>{const r=await fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify({action,path,id,data})});const out=await r.json();assert.equal(r.status,200,JSON.stringify(out));return out;};
  const readClinic = ()=>db('getDoc','clinics',cid);
  if (legacy) await db('updateDoc','clinics/'+cid,cid,{customDentalServices:[{id:'legacy-full',name:names[1],price:8765,condition:'ortho',category:en?'Orthodontics & Cosmetic':cat}],dentalServiceCategories:[en?'Orthodontics & Cosmetic':cat]});
  await db('setDoc',`clinics/${cid}/patients`,'ortho_patient',{name:'Ortho Test Patient',phone:'01000000000',loyaltyPoints:0});
  console.log('Authenticated and patient created '+label);
  if(process.env.TEST_MATERIAL_ONLY==='1'||process.env.TEST_EMPTY_ONLY==='1')await db('updateDoc','clinics/'+cid,cid,{customDentalServices:process.env.TEST_EMPTY_ONLY==='1'?[]:[{id:'material-db',name:'Database Material',price:2345,condition:'filled',category:cat}],dentalServiceCategories:[cat],orthodonticCatalogVersion:1});
  const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1440,height:1050});
  await page.evaluateOnNewDocument((token,clinic,language)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:clinic.id,clinicName:clinic.name}));localStorage.setItem('i18nextLng',language);localStorage.setItem('auto_backup_last_date_'+clinic.id,new Date().toISOString().slice(0,10));},login.token,login.clinic,lang);
  const click = async(text,exact=false)=>{assert.ok(await page.evaluate((t,x)=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&(x?b.textContent.trim()===t:b.textContent.includes(t)));b?.click();return !!b;},text,exact),'Missing '+text);};
  const fill = async(sel,text)=>{await page.click(sel);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');if(text)await page.type(sel,text);};
  const idle=()=>page.waitForFunction(()=>document.querySelector('[data-testid="services-settings"]')?.getAttribute('aria-busy')==='false');
  const settings=async()=>{await click(en?'Settings':'الإعدادات');await page.waitForFunction(e=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes(e?'Prices & Services List':'قائمة الأسعار والخدمات')),{},en);await click(en?'Prices & Services List':'قائمة الأسعار والخدمات');await page.waitForSelector('[data-testid="services-table"]');};
  const search=async(name)=>{await fill('[data-testid="services-search"]',name);await page.waitForFunction(n=>[...document.querySelectorAll('[data-testid="service-row"]')].some(r=>r.textContent.includes(n)),{},name);};
  const openPatient=async()=>{await click(en?'Patients Manager':'إدارة المرضى');await page.waitForFunction(()=>document.body.innerText.includes('Ortho Test Patient'));assert.ok(await page.evaluate(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('Ortho Test Patient'));const b=row?.querySelector('button[title="Medical File"],button[title="الملف الطبي"]');b?.click();return !!b;}));await page.waitForFunction(e=>document.body.innerText.includes(e?'Select Multiple Teeth':'تحديد أسنان متعددة'),{},en);};
  const input=en?'input[placeholder="Select a procedure or type a custom service..."]':'input[placeholder="اختر إجراء أو اكتب خدمة مخصصة..."]';
  const openModal=async()=>{await page.evaluate(()=>document.querySelector('button.w-9.h-12')?.click());await page.waitForSelector(input);};
  const cards=()=>page.$$eval('[data-testid="tooth-service-card"]',es=>es.map(e=>e.textContent));
  const filterOrtho=async()=>{assert.ok(await page.evaluate(c=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim().startsWith(c+' ('));b?.click();return !!b;},cat));};
  try {
    console.log('Browser ready '+label);
    await page.goto(base,{waitUntil:'networkidle2'});
    console.log('App loaded '+label);
    if(process.env.TEST_MATERIAL_ONLY==='1') {
      await openPatient();await openModal();
      await page.waitForSelector('[data-testid="catalog-material-shortcut"]');
      assert((await page.$eval('[data-testid="catalog-material-shortcut"]',e=>e.textContent)).includes('Database Material'));
      await page.click('[data-testid="catalog-material-shortcut"]');
      assert.equal(await page.$eval(input,e=>e.value),'Database Material');
      assert(await page.evaluate(()=>[...document.querySelectorAll('input[type=number]')].some(e=>e.value==='2345')));
      console.log('PASS database-backed material shortcut '+label);return;
    }
    if(process.env.TEST_EMPTY_ONLY==='1') {
      await openPatient();await openModal();
      assert.equal((await cards()).length,0);
      assert.equal(await page.$('[data-testid="catalog-material-shortcut"]'),null);
      assert.equal(await page.$eval(input,e=>e.value),'');
      assert(await page.evaluate(()=>[...document.querySelectorAll('input[type=number]')].some(e=>e.value==='0')));
      console.log('PASS empty catalog has no fallback '+label);return;
    }
    await settings();
    for(const name of names)await search(name);
    await fill('[data-testid="services-search"]','');
    // Select the ortho category in settings and show all its catalog rows.
    await click(cat);
    while(await page.$('[data-testid="services-show-more"]'))await page.click('[data-testid="services-show-more"]');
    await page.screenshot({path:`/downloads/ortho-${label}-settings.png`,fullPage:true});
    let clinic=await readClinic();assert.equal(clinic.orthodonticCatalogVersion,1);
    for(const name of names)assert.equal(clinic.customDentalServices.filter(s=>s.name===name).length,1);
    assert.equal(clinic.customDentalServices.filter(s=>s.category===cat).length,6,'exactly six ortho services in persisted catalog');
    if(legacy)assert(clinic.customDentalServices.some(s=>s.id==='legacy-full'&&s.name===names[1]&&s.price===8765),'existing ID and custom price preserved');
    await openPatient();await openModal();await filterOrtho();
    const available=await cards();assert.equal(available.length,6,'exactly six ortho cards after filtering');for(const name of names)assert(available.some(t=>t.includes(name)),name+' modal category');
    await click(names[0]);await page.screenshot({path:`/downloads/ortho-${label}-modal.png`,fullPage:true});await click(en?'Cancel':'إلغاء',true);
    await settings();await search(names[0]);
    await page.evaluate(n=>[...document.querySelectorAll('[data-testid="service-row"]')].find(r=>r.textContent.includes(n)).querySelector('button[title="Edit Service"],button[title="تعديل الخدمة والسعر"]').click(),names[0]);
    await page.waitForSelector('[data-testid="service-form-panel"]');
    await fill('[data-testid="service-form-panel"] input[type=text]',renamed);await fill('[data-testid="service-form-panel"] input[type=number]','4321');
    await page.click('[data-testid="service-form-panel"] button[type=submit]');await page.waitForFunction(()=>!document.querySelector('[data-testid="service-form-panel"]'));await idle();
    await search(names[5]);
    await page.evaluate(n=>[...document.querySelectorAll('[data-testid="service-row"]')].find(r=>r.textContent.includes(n)).querySelector('button[title="Delete Service"],button[title="حذف الخدمة"]').click(),names[5]);
    await click(en?'Yes, delete':'نعم، متأكد');await idle();
    // The full UI flow emits many real sync reads. Respect the normal API limiter.
    console.log('Rename/delete passed, respecting limiter '+label);
    await new Promise(r=>setTimeout(r,62000));
    console.log('Continuing session '+label);
    await openPatient();await openModal();await filterOrtho();
    const changed=await cards();assert(changed.some(t=>t.includes(renamed)));assert(!changed.some(t=>t.includes(names[0])));assert(!changed.some(t=>t.includes(names[5])));
    await click(renamed);assert.equal(await page.$eval(input,e=>e.value),renamed);assert(await page.evaluate(()=>[...document.querySelectorAll('input[type=number]')].some(e=>e.value==='4321')));
    await page.screenshot({path:`/downloads/ortho-${label}-renamed.png`,fullPage:true});
    await click(en?'Save to Sessions':'حفظ في الجلسات',true);await page.waitForFunction(()=>!document.querySelector('input[placeholder="Select a procedure or type a custom service..."],input[placeholder="اختر إجراء أو اكتب خدمة مخصصة..."]'));
    let appointments;for(let i=0;i<25;i++){appointments=await db('getDocs',`clinics/${cid}/appointments`);if(JSON.stringify(appointments).includes(renamed))break;await new Promise(r=>setTimeout(r,100));}
    assert(JSON.stringify(appointments).includes(renamed));assert(JSON.stringify(appointments).includes('4321'));
    assert(JSON.stringify(await db('getDoc',`clinics/${cid}/patients`,'ortho_patient')).includes(renamed));
    await page.reload({waitUntil:'networkidle2'});await openPatient();await openModal();await filterOrtho();
    const reloaded=await cards();assert(reloaded.some(t=>t.includes(renamed)));assert(!reloaded.some(t=>t.includes(names[0])));assert(!reloaded.some(t=>t.includes(names[5])));
    await click(en?'Cancel':'إلغاء',true);await settings();await search(renamed);
    clinic=await readClinic();assert(!clinic.customDentalServices.some(s=>s.name===names[5]));assert(clinic.customDentalServices.some(s=>s.name===renamed&&s.price===4321));
    console.log('Reload and session passed '+label);
    assert.deepEqual(errors,[]);
    console.log('PASS '+label+': fresh persisted catalog has all 6, settings/modal category filter, rename/price update, permanent delete after navigation and reload, session/appointment/tooth history saved, no browser errors.');
  } catch(e) {await page.screenshot({path:`/downloads/ortho-${label}-failure.png`,fullPage:true});console.log((await page.evaluate(()=>document.body.innerText)).slice(-9000));throw e;}
  finally {clearTimeout(watchdog);await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
