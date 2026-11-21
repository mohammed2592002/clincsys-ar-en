import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import puppeteer from 'puppeteer-core';
const dir=await mkdtemp(join(tmpdir(),'coredent-login-'));
const clinic={id:'login_test',name:'Login Test Clinic',email:'login@example.invalid',password:'local-test-password',staffPin:'4826',isActive:true,subscriptionExpiresAt:'2030-01-01',staffMembers:[{id:'staff1',name:'Test Staff',role:'Reception',password:'local-staff-password',allowedTabs:['calendar']}]};
await writeFile(join(dir,'local_db.json'),JSON.stringify({clinics:[{id:clinic.id,data:JSON.stringify(clinic)}],system_settings:[{id:'support',data:JSON.stringify({trialPhoneNumber:'01000000000',socialLinks:[{id:'test-support',platform:'website',url:'https://example.invalid/support',title:'الدعم الفني'}]})}]}));
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base=`http://127.0.0.1:${port}`;
const env={...process.env,NODE_ENV:'production',PORT:String(port),AUTH_SECRET:'isolated-login-test-secret'};
for(const k of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME'])delete env[k];
const server=spawn(process.execPath,[resolve('dist-server/server.cjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
let browser;
try{
for(let i=0;i<100;i++){try{await fetch(base);break;}catch{}await new Promise(r=>setTimeout(r,100));}
browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.evaluateOnNewDocument(()=>{localStorage.setItem('i18nextLng','ar');window.open=(...args)=>{window.__lastOpen=args;return null;};});
await mkdir('/downloads/login-proof',{recursive:true});
for(const lang of ['ar','en']){
 await page.goto(base+'/login',{waitUntil:'networkidle0'});await page.waitForSelector('.cd-form-wrap');
 if(lang==='en')await page.click('.cd-language');
 await page.evaluate(()=>document.fonts.ready);
 for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844],['narrow',320,844]]){
 await page.setViewport({width,height,deviceScaleFactor:2});
 await page.screenshot({path:`/downloads/login-proof/${lang}-${name}.png`,fullPage:true});
 const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dims.scroll<=dims.width,JSON.stringify(dims));
 }
}
await page.setViewport({width:1440,height:960});await page.goto(base+'/login',{waitUntil:'networkidle0'});
await page.waitForFunction(()=>!document.querySelector('.cd-trial button').disabled);
assert.equal(await page.$eval('.cd-support-links a',e=>e.href),'https://example.invalid/support');
await page.click('.cd-trial button');const opened=await page.evaluate(()=>window.__lastOpen);assert(opened[0].startsWith('https://wa.me/201000000000?text='));assert(decodeURIComponent(opened[0]).includes('7 أيام.'));assert.equal(opened[2],'noopener,noreferrer');
await page.type('#login-email',clinic.email);await page.type('#login-password','wrong-password');
await page.click('.cd-eye');assert.equal(await page.$eval('#login-password',e=>e.type),'text');await page.click('.cd-eye');assert.equal(await page.$eval('#login-password',e=>e.type),'password');
const managerResponse=page.waitForResponse(r=>r.url().endsWith('/api/auth/clinic-login'));
await page.click('.cd-submit');assert.equal((await managerResponse).status(),401);await page.waitForSelector('[role=alert]');
await page.click('.cd-role:nth-child(2)');await page.waitForFunction(()=>!document.querySelector('[role=alert]'));assert((await page.$eval('label[for=login-password]',e=>e.textContent)).includes('PIN'));
const staffResponse=page.waitForResponse(r=>r.url().endsWith('/api/auth/clinic-login'));
await page.click('.cd-submit');const response=await staffResponse;assert.equal(JSON.parse(response.request().postData()).role,'staff');assert.equal(response.status(),401);
await page.waitForSelector('[role=alert]');await page.screenshot({path:'/downloads/login-proof/staff-error.png',fullPage:true});
// Server-side manager, staff password, staff PIN and superadmin regression, isolated DB only.
for(const [role,password] of [['manager',clinic.password],['staff','local-staff-password'],['staff',clinic.staffPin]]){
const res=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:clinic.email,password,role})});const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));assert(body.success&&body.token);console.log('PASS real server login:',role,password===clinic.staffPin?'PIN':'password');}
const admin=await fetch(base+'/api/superadmin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@crowndent.com',password:'admin123'})}).then(r=>r.json());assert(admin.token);console.log('PASS superadmin login');
// Real UI successful staff login with PIN, not a mocked handler.
await page.$eval('#login-password',e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'4826');e.dispatchEvent(new Event('input',{bubbles:true}));});
await page.click('.cd-submit');await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dental_saas_session')||'{}').type==='clinic_staff');
console.log('PASS UI staff PIN session');
const managerPage=await browser.newPage();await managerPage.evaluateOnNewDocument(()=>{localStorage.clear();localStorage.setItem('i18nextLng','en');});await managerPage.goto(base+'/login',{waitUntil:'networkidle0'});await managerPage.waitForSelector('#login-email');await managerPage.type('#login-email',clinic.email);await managerPage.type('#login-password',clinic.password);await managerPage.click('.cd-submit');await managerPage.waitForFunction(()=>JSON.parse(localStorage.getItem('dental_saas_session')||'{}').type==='clinic');await managerPage.close();console.log('PASS UI manager session');assert.deepEqual(errors,[]);console.log('PASS AR/EN 1440/390/320 no horizontal overflow, trial normalization, configured support, password toggle, error reset, manager/staff role payload, successful auth, no browser JS errors.');
}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.on('exit',r));await rm(dir,{recursive:true,force:true});}
