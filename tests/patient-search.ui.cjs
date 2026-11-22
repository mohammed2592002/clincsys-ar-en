const assert=require('node:assert/strict'),puppeteer=require('puppeteer-core'),fs=require('node:fs');
const base=process.env.TEST_BASE,cid='finance_isolated_test',en=process.env.TEST_LANG==='en',lang=en?'en':'ar';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());assert(login.token);
 const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify(body)});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;};
 // One backup merge seeds 230 synthetic patients without producing artificial API quota pressure.
 const backup=await post('/api/backups',{action:'export_clinic',clinicId:cid});
 const inspect=(o)=>{if(!o||typeof o!=='object')return null;if(Array.isArray(o.patients))return o;for(const v of Object.values(o)){const x=inspect(v);if(x)return x;}return null;};
 const holder=inspect(backup);assert(holder,'backup patient array');holder.patients=Array.from({length:230},(_,i)=>({id:'lookup-'+i,clinicId:cid,name:i===0?'Older Whole Clinic Target':'Synthetic List Patient '+i,phone:'010'+String(i).padStart(8,'0'),createdAt:i===0?'2000-01-01':'2026-11-22T12:00:00Z'}));
 await post('/api/backups',{action:'restore_clinic',clinicId:cid,backup});

 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage(),requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')){let body={};try{body=JSON.parse(r.postData()||'{}')}catch{}requests.push({url:r.url(),body});}});
 await page.setViewport({width:1280,height:1000});await page.evaluateOnNewDocument((token,clinic,language)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:clinic.id,clinicName:clinic.name}));localStorage.setItem('i18nextLng',language);localStorage.setItem('auto_backup_last_date_'+clinic.id,new Date().toISOString().slice(0,10));},login.token,login.clinic,lang);
 const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim()===t),{},text);await page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===t).click(),text);};
 try{
 await page.goto(base,{waitUntil:'networkidle2'});await click(en?'Patients Manager':'إدارة المرضى');await wait(1700);
 const initial=requests.filter(r=>r.body.action==='getDocs'&&r.body.path==='clinics/'+cid+'/patients');assert(initial.length);assert(initial.every(r=>(r.body.constraints||[]).some(c=>c.type==='limit'&&c.limit<=100)),JSON.stringify(initial));
 const input=await page.$('input[placeholder*="Search"],input[placeholder*="بحث"]');assert(input);await input.type('Older Whole Clinic Target');await page.waitForFunction(()=>document.body.innerText.includes('Older Whole Clinic Target'));assert(requests.some(r=>r.url.includes('/api/patients/search')));
 fs.mkdirSync('/downloads/scoped-fixes-proof',{recursive:true});await page.screenshot({path:'/downloads/scoped-fixes-proof/'+lang+'-patient-search.png',fullPage:true});
 console.log('PASS '+lang+' patient screen has bounded initial reads, server search finds oldest patient');
 await click(en?'Appointments & Calendar':'سجل المواعيد');await wait(1500);await click(en?'Book New Appointment':'حجز موعد جديد');
 const selector='input[placeholder*="ابحث باسم المريض"],input[placeholder*="Search patient"],input[placeholder*="Search by patient"]';await page.waitForSelector(selector,{visible:true});await page.type(selector,'Older Whole Clinic Target');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Older Whole Clinic Target')));await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Older Whole Clinic Target')).click());
 assert.equal(await page.$eval(selector,e=>e.value),'Older Whole Clinic Target');await page.screenshot({path:'/downloads/scoped-fixes-proof/'+lang+'-booking-search.png',fullPage:true});
 const form=await page.$('form');assert(form);await form.evaluate(e=>e.requestSubmit());await page.waitForFunction(s=>!document.querySelector(s),{timeout:20000},selector);
 const apps=await post('/api/db',{action:'getDocs',path:'clinics/'+cid+'/appointments'});assert(apps.some(a=>a.patientId==='lookup-0'));assert.equal(errors.length,0,errors.join(';'));
 console.log('PASS '+lang+' booking server-searches oldest patient beyond first 100 and saves real appointment');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
