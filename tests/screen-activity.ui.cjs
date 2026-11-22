const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const fs=require('node:fs');
const base=process.env.TEST_BASE,cid='finance_isolated_test',lang=process.env.TEST_LANG||'ar',en=lang==='en';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const out='/downloads/screen-activity-proof';fs.mkdirSync(out,{recursive:true});
(async()=>{
const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());assert(login.token);
const api=async body=>{const r=await fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify(body)});const x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x;};
await api({action:'setDoc',path:`clinics/${cid}/patients`,id:'activity_patient',data:{name:'Activity Baseline Patient',phone:'01000000000',createdAt:new Date().toISOString()}});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage(),requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().includes('/api/')){let body={};try{body=JSON.parse(r.postData()||'{}')}catch{}requests.push({at:Date.now(),path:new URL(r.url()).pathname,action:body.action,queryPath:body.path});}});
await page.setViewport({width:1280,height:900});
await page.evaluateOnNewDocument((token,clinic,language)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:clinic.id,clinicName:clinic.name}));localStorage.setItem('i18nextLng',language);localStorage.setItem('auto_backup_last_date_'+clinic.id,new Date().toISOString().slice(0,10));},login.token,login.clinic,lang);
const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim()===t),{},text);await page.evaluate(t=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===t).click(),text);};
const samples=[];
const windowTest=async(name,duration=Number(process.env.TEST_IDLE_MS||31000))=>{const start=Date.now();await wait(duration);const rows=requests.filter(r=>r.at>=start);const nonBroadcast=rows.filter(r=>r.path!=='/api/broadcasts/active');samples.push({name,durationMs:Date.now()-start,requests:rows});assert.equal(nonBroadcast.length,0,name+' must have only broadcast requests: '+JSON.stringify(nonBroadcast));console.log('PASS '+lang+' '+name+': '+rows.length+' broadcasts, ZERO other requests');};
try{
await page.goto(base,{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('Activity Baseline Patient'));
await windowTest('patients open-idle');
const settings=en?'Settings':'الإعدادات';await click(settings);await page.waitForFunction(()=>document.querySelector('input[value]')!==null);await wait(1800);
await windowTest('settings open-idle / patients left');
// A real second authenticated browser session edits a patient while Settings is active.
const second=await browser.newPage();await second.goto(base+'/login');await second.evaluate(async({token,cid})=>{const response=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'updateDoc',path:'clinics/'+cid+'/patients',id:'activity_patient',data:{name:'Changed In Second Session'}})});if(!response.ok)throw Error(await response.text());},{token:login.token,cid});
await page.bringToFront();await wait(1800);await windowTest('settings after unrelated patient change',6000);
await click(en?'Patients Manager':'إدارة المرضى');await page.waitForFunction(()=>document.body.innerText.includes('Changed In Second Session'));
// Current screen must update on a genuine record change without manual reload.
await second.evaluate(async({token,cid})=>{await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'updateDoc',path:'clinics/'+cid+'/patients',id:'activity_patient',data:{name:'Live Visible Change'}})});},{token:login.token,cid});
await page.waitForFunction(()=>document.body.innerText.includes('Live Visible Change'));console.log('PASS '+lang+' visible screen receives actual change from second session');
await page.screenshot({path:out+'/'+lang+'-patients.png',fullPage:true});
// Override visibility through the native event used by the application; keep the DOM and drafts.
await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await wait(1500);await windowTest('browser hidden',10000);
await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>document.body.innerText.includes('Live Visible Change'));
await wait(1500);await windowTest('patients resumed idle',6000);
if(process.env.TEST_QUEUED_WRITE==='1'){
 await click(en?'Settings':'الإعدادات');await wait(1500);
 await page.evaluate(async({cid,token})=>{
 const raw=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
 const owner=[raw.type,raw.clinicId||'',raw.staffId||''].join(':');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('CoreDentCommands',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction('commands','readwrite');tx.objectStore('commands').put({id:crypto.randomUUID(),screen:'patients',owner,clinicId:cid,body:{action:'write',table:'patients',id:'queued_activity_patient',data:{name:'Queued screen patient',phone:'01000000001'},create:true,optimistic:true,localPath:'clinics/'+cid+'/patients'},localPath:'clinics/'+cid+'/patients',localId:'queued_activity_patient',fingerprint:'test-screen-ownership',createdAt:new Date().toISOString(),status:'pending',financial:false});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();window.dispatchEvent(new Event('online'));
 },{cid,token:login.token});
 await windowTest('Settings does not write Patients queue',11000);
 await click(en?'Patients Manager':'إدارة المرضى');
 await page.waitForFunction(()=>document.body.innerText.includes('Queued screen patient'),{timeout:20000});
 console.log('PASS '+lang+' queued write paused on wrong screen and resumed on owner screen');
}

if(process.env.TEST_ALL_SCREENS==='1'){
 for(const text of (en?['Appointments & Calendar','Prescriptions','Lab Tracking','Financials & Accounting','Settings']:['سجل المواعيد','الروشتة العلاجية','إدارة المعامل','الحسابات والمالية','الإعدادات'])){
  await click(text);await wait(2000);await windowTest(text+' idle',Number(process.env.TEST_WINDOW_MS||6000));
  await page.screenshot({path:out+'/'+lang+'-'+text.replace(/[^a-z0-9]/gi,'_')+'.png',fullPage:true});
 }
}

fs.writeFileSync(out+'/'+lang+'-measurements.json',JSON.stringify({samples,errors},null,2));assert.deepEqual(errors,[]);console.log('PASS '+lang+' preserved UI and hidden/resume lifecycle');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
