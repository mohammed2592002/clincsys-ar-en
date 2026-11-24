import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtemp,writeFile,readFile,readdir,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {build} from 'esbuild';
import JSZip from 'jszip';
import puppeteer from 'puppeteer-core';
const cid='backup_isolated_test',out=process.env.TEST_ARTIFACT_DIR||'/downloads/backup-print-proof';
await mkdir(out,{recursive:true});
const tests=[];const pass=name=>{tests.push(name);console.log('PASS '+name);};
const secret='isolated-backup-test-only-secret';
function signed(type,clinicId=cid){const body=Buffer.from(JSON.stringify({type,clinicId,exp:Date.now()+3600000})).toString('base64url');return `v1.${body}.${crypto.createHmac('sha256',secret).update(body).digest('base64url')}`;}
const manager=signed('manager'),admin=signed('admin');
const clinic={id:cid,name:'عيادة اختبار الاستعادة',nameEn:'Restore Test Clinic',doctorName:'طبيب اختبار',doctorNameEn:'Test Doctor',email:'backup@example.invalid',password:'isolated-only-password',isActive:true,subscriptionExpiresAt:'2030-01-01',staffPin:'736291',staffMembers:[{id:'backup_staff',name:'Backup Test Staff',role:'استقبال',password:'isolated-staff-password',allowedTabs:['calendar']}],autoBackupEnabled:false};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
async function server(source=false){
 const dir=await mkdtemp(join(tmpdir(),'clinic-backup-test-'));const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const record=(id,data)=>({id,clinicId:cid,data:JSON.stringify({id,clinicId:cid,...data})});
 await writeFile(join(dir,'local_db.json'),JSON.stringify({clinics:[{id:cid,data:JSON.stringify(clinic)}],patients:[record('backup_seed',{name:'Bootstrap patient'})],...(source?{expenses:[record('legacy_expense',{title:'Legacy assigned cash expense',amount:5,paymentMethod:'كاش',date:'2020-01-01',type:'shift'})]}:{})}));
 const env={...process.env,NODE_ENV:'production', ALLOW_LOCAL_JSON_DB: '1', PORT:String(port),AUTH_SECRET:secret};
 for(const key of Object.keys(env))if(/^(DATABASE_URL|POSTGRES_URL|PG_DATABASE_URL|PGHOST|DB_HOST|PGUSER|PGPASSWORD|DB_PASSWORD|PGDATABASE|DB_NAME|R2_|AWS_|CLOUDFLARE_)/.test(key))delete env[key];
 const child=spawn(process.execPath,[resolve('dist-server/server.cjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<100;i++){try{await fetch(base);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 return {base,dir,close:async()=>{child.kill();await new Promise(r=>child.on('exit',r));await rm(dir,{recursive:true,force:true});}};
}
async function call(s,path,body,status=200,token=manager){const r=await fetch(s.base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify({path,body,d}));return d;}
const backup=(s,action,body={},status=200,token=manager)=>call(s,'/api/backups',{action,clinicId:cid,...body},status,token);
const fin=(s,body,status=200)=>call(s,'/api/finance',{clinicId:cid,requestId:crypto.randomUUID(),...body},status);
const db=(s,action,table,id,data,status=200,token=manager)=>call(s,'/api/db',{action,path:table==='clinics'?'clinics':`clinics/${cid}/${table}`,id,data},status,token);
const source=await server(true);let browser;
try{
 await db(source,'setDoc','patients','backup_patient',{name:'Round Trip Patient',phone:'01000000000',loyaltyPoints:0});
 await db(source,'setDoc','appointments','backup_visit',{patientId:'backup_patient',patientName:'Round Trip Patient',date:today,time:'10:00',price:1000,paidAmount:0,status:'completed'});
 const methods=['كاش','فيزا','محفظة','إنستاباي','قرش تاريخي'];await fin(source,{action:'write',table:'clinics',id:cid,data:{paymentMethods:methods}});
 const shift=await fin(source,{action:'open',date:today,startCash:50});
 const collect={action:'collect',clinicId:cid,requestId:crypto.randomUUID(),appointmentId:'backup_visit',amount:100,paymentMethod:'كاش'};
 const cash=(await call(source,'/api/finance',collect)).receipt;
 await fin(source,{action:'collect',appointmentId:'backup_visit',amount:80,paymentMethod:'محفظة'});
 const cent=(await fin(source,{action:'collect',appointmentId:'backup_visit',amount:.01,paymentMethod:'قرش تاريخي'})).receipt;
 await fin(source,{action:'refund',appointmentId:'backup_visit',receiptId:cent.id,amount:.01,reason:'Full historical cent refund'});
 await fin(source,{action:'write',table:'expenses',id:'backup_expense',data:{title:'Cash expense',amount:7,paymentMethod:'كاش',type:'shift',date:today}});
 await fin(source,{action:'write',table:'lab_orders',id:'backup_lab',data:{patientId:'backup_patient',patientName:'Round Trip Patient',cost:100,paidAmount:17,paymentMethod:'فيزا',status:'sent'}});
 await fin(source,{action:'assign_legacy',sourceType:'expense',sourceId:'legacy_expense',shiftId:shift.id,reason:'Isolated legacy settlement'});
 const closed=await fin(source,{action:'close',shiftId:shift.id,actualCash:138});assert.equal(closed.expectedCash,138);assert.equal(closed.discrepancy,0);
 let snapshot=await backup(source,'export_clinic');assert.equal(snapshot.schemaVersion,3);assert(snapshot.data.finance_state.assignments['expense:legacy_expense']);assert(snapshot.data.finance_state.events.length);assert(Object.keys(snapshot.data.finance_state.requests).length>=10);assert.match(snapshot.clinicInfo.password,/^scrypt\$/);assert.equal(snapshot.credentialSchemaVersion,1);
 pass('Authoritative snapshot includes receipts, refunds, audit events, idempotency requests, legacy assignments and immutable closing');
 assert.deepEqual((await backup(source,'export_clinic',{},200,signed('staff'))).data.finance_state,snapshot.data.finance_state);await backup(source,'restore_clinic',{backup:snapshot},403,signed('staff'));await backup(source,'export_clinic',{},401,signed('manager','another_clinic'));await backup(source,'export_system',{},403);await backup(source,'export_clinic',{},401,'invalid');
 pass('Existing staff read-only backup retained; staff restore, unauthenticated, cross-clinic and non-admin full-system access rejected');
 // Bundle the real client exporter only for this isolated test server. Never committed or deployed.
 await build({entryPoints:['src/utils/backupService.ts'],bundle:true,format:'esm',platform:'browser',define:{'import.meta.env':'{}'},outfile:'dist/backup-test-module.js'});
 browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();await page.setViewport({width:1440,height:1050});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.evaluateOnNewDocument((t,c)=>{localStorage.setItem('dental_auth_token',t);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:c.id,clinicName:c.name}));localStorage.setItem('i18nextLng','en');localStorage.setItem('auto_backup_last_date_'+c.id,new Date().toISOString().slice(0,10));},manager,clinic);
 await page.goto(source.base,{waitUntil:'networkidle2'});await page.evaluate(async()=>{window.backupTest=await import('/backup-test-module.js');});
 snapshot=await backup(source,'export_clinic');
 const session=await page.createCDPSession();let serial=0;
 async function download(run){const folder=join(out,'download-'+(++serial));await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});await session.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:folder});await page.evaluate(()=>{window.lastBackupFilename=null;if(!window.backupFilenameListener){window.backupFilenameListener=true;document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a)window.lastBackupFilename=a.download;},true);}});await run();let files=[];for(let i=0;i<100;i++){files=(await readdir(folder)).filter(f=>!f.endsWith('.crdownload'));if(files.length)break;await new Promise(r=>setTimeout(r,100));}assert.equal(files.length,1);const name=files[0]==='download'?await page.evaluate(()=>window.lastBackupFilename):files[0];assert(name);return {name,path:join(folder,files[0]),bytes:await readFile(join(folder,files[0]))};}
 async function parse(file){let text;if(file.name.endsWith('.zip')){const zip=await JSZip.loadAsync(file.bytes);text=await Object.values(zip.files).find(f=>!f.dir).async('string');}else text=file.bytes.toString('utf8');if(file.name.endsWith('.sql')){assert(text.includes('CREATE TABLE IF NOT EXISTS finance_state'));text=Buffer.from(text.match(/^-- CMS_BACKUP_JSON_V3:([A-Za-z0-9+/=]+)$/m)[1],'base64').toString('utf8');}return JSON.parse(text);}
 const exported=[];
 for(const format of ['json','db','zip','sql']){
  const file=await download(()=>page.evaluate((cid,c,format)=>window.backupTest.exportClinicBackup(cid,c,format),cid,clinic,format));const payload=await parse(file);assert.match(payload.clinicInfo.password,/^scrypt\$/);assert.match(payload.clinicInfo.staffPin,/^scrypt\$/);assert.match(payload.clinicInfo.staffMembers[0].password,/^scrypt\$/);assert.deepEqual(payload.data.finance_state,snapshot.data.finance_state);exported.push({format,payload,file});
  const clientRead=await page.evaluate(async(data,name)=>{const f=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],name);return JSON.parse((await window.backupTest.readBackupFile(f)).text);},file.bytes.toString('base64'),file.name);assert.deepEqual(clientRead,payload);
  const dest=await server();try{
   await db(dest,'deleteDoc','clinics',cid,undefined,200,admin);
   const result=await backup(dest,'restore_clinic',{backup:payload},200,admin);assert.deepEqual(result.warnings,[]);
   for(const [password,role] of [[clinic.password,'manager'],[clinic.staffPin,'staff'],[clinic.staffMembers[0].password,'staff']]){const login=await call(dest,'/api/auth/clinic-login',{email:clinic.email,password,role});assert.equal(login.success,true);}
   const restored=await backup(dest,'export_clinic');assert.deepEqual(restored.data.finance_state,snapshot.data.finance_state);assert.deepEqual((await db(dest,'getDoc','shifts',shift.id)).snapshot,closed.snapshot);
   await call(dest,'/api/finance',collect);assert.deepEqual((await backup(dest,'export_clinic')).data.finance_state,snapshot.data.finance_state);
   await fin(dest,{action:'write',table:'clinics',id:cid,data:{paymentMethods:methods.filter(m=>m!=='قرش تاريخي')}},409);
   await fin(dest,{action:'open',date:today,startCash:0});const refund=await fin(dest,{action:'refund',appointmentId:'backup_visit',receiptId:cash.id,amount:10,reason:'Refund restored receipt'});assert.equal(refund.receipt.paymentMethod,'كاش');assert.equal((await db(dest,'getDoc','appointments','backup_visit')).paidAmount,170);
   assert.deepEqual((await db(dest,'getDoc','shifts',shift.id)).snapshot,closed.snapshot);
   pass(format.toUpperCase()+' actual browser download to fresh isolated DB: exact ledger + assignments, retry not duplicated, original receipt refund, owner/staff/PIN logins, historical one-cent deletion guard, closed snapshot unchanged');
  }finally{await dest.close();}
 }
 // All restores are additive. A stale financial value is rejected, never silently rewinds current money.
 const bad=structuredClone(snapshot);bad.data.appointments.find(a=>a.id==='backup_visit').paidAmount=1;bad.data.patients.push({id:'must_rollback',name:'Must not persist'});
 await backup(source,'restore_clinic',{backup:bad},409);assert.equal(await db(source,'getDoc','patients','must_rollback'),null);assert.deepEqual((await backup(source,'export_clinic')).data.finance_state,snapshot.data.finance_state);
 const malformed=structuredClone(snapshot);malformed.data.finance_state.receipts[0].amountCents=-1;await backup(source,'restore_clinic',{backup:malformed},400);
 const unsafe=structuredClone(snapshot);unsafe.data.finance_state.requests.bad={recordRef:{table:'not_a_table',id:'x'}};await backup(source,'restore_clinic',{backup:unsafe},400);
 const privilege=structuredClone(snapshot);privilege.clinicInfo={...privilege.clinicInfo,password:'must-not-change',subscriptionExpiresAt:'2099-01-01',isActive:false,staffMembers:[{id:'bad',name:'Injected staff'}]};await backup(source,'restore_clinic',{backup:privilege},400);
 const current=await db(source,'getDoc','clinics',cid);assert.equal(current.subscriptionExpiresAt,'2030-01-01');assert.equal(current.isActive,true);assert.deepEqual(current.staffMembers,clinic.staffMembers.map(({password,...rest})=>rest));
 await call(source,'/api/auth/clinic-login',{email:clinic.email,password:clinic.password,role:'manager'});
 pass('Conflicting financial data rolls back without partial records; malformed amounts/reference tables and manager privilege escalation blocked; login preserved');
 const legacy=structuredClone(snapshot);delete legacy.data.finance_state;const lr=await backup(source,'restore_clinic',{backup:legacy});assert.equal(lr.warnings.length,1);assert.deepEqual((await backup(source,'export_clinic')).data.finance_state,snapshot.data.finance_state);
 const fresh=await server();try{const old={patients:[{phone:'01001234567',name:'Old nested format',records:[{id:'old_record',notes:'Preserved record'}]}],appointments:[],customMedications:[{id:'old_med',name:'Old medicine'}],dailyClosings:[]};const r=await backup(fresh,'restore_clinic',{backup:old});assert(r.warnings.length);assert.equal((await db(fresh,'getDoc','records','old_record')).patientId,'01001234567');assert.equal((await db(fresh,'getDoc','custom_medications','old_med')).name,'Old medicine');}finally{await fresh.close();}
 pass('Legacy files remain importable, nested records/camelCase tables retained; explicit missing-history warning; existing financial history never erased');
 await db(source,'setDoc','clinics','foreign_clinic',{name:'Foreign clinic',isActive:true},200,admin);
 await call(source,'/api/db',{action:'setDoc',path:'clinics/foreign_clinic/patients',id:'foreign_patient',data:{name:'Foreign'}},200,admin);
 const collision=structuredClone(snapshot);collision.data.patients.push({id:'foreign_patient',name:'Collision'});await backup(source,'restore_clinic',{backup:collision},403);
 pass('Global record-ID collision cannot overwrite another clinic');
 const full=await backup(source,'export_system',{},200,admin);assert(full.clinics.every(c=>c.finance_state));assert(!full.systemSettings.some(x=>x.id==='auth_secret'));
 await page.evaluate(t=>localStorage.setItem('dental_auth_token',t),admin);
 for(const format of ['json','db','zip','sql']){const file=await download(()=>page.evaluate(format=>window.backupTest.exportFullSystemBackup(format),format));const payload=await parse(file);assert.deepEqual(payload.clinics.find(c=>c.clinicInfo.id===cid).finance_state,snapshot.data.finance_state);const dest=await server();try{const r=await backup(dest,'restore_system',{backup:payload},200,admin);assert.equal(r.restoredClinics.length,2);assert.deepEqual((await backup(dest,'export_clinic')).data.finance_state,snapshot.data.finance_state);}finally{await dest.close();}}
 pass('Full-system JSON/DB/ZIP/SQL actual downloads and per-clinic atomic restores retain finance_state; auth_secret is excluded');
 const invalidFull=structuredClone(full);invalidFull.clinics.push({clinicInfo:{id:'bad'},patients:'invalid'});await backup(source,'restore_system',{backup:invalidFull},400,admin);
 // Actual clinic backup UI uses its own export handler; verify every format, independent of the shared exporter.
 await page.evaluate(t=>localStorage.setItem('dental_auth_token',t),manager);
 const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button,a')].some(b=>b.getClientRects().length&&b.textContent.includes(t)),{},text);await page.evaluate(t=>[...document.querySelectorAll('button,a')].find(b=>b.getClientRects().length&&b.textContent.includes(t)).click(),text);await new Promise(r=>setTimeout(r,250));};
 await click('Settings');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim().startsWith('Backup')));await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim().startsWith('Backup')).click());
 for(const format of ['json','db','zip','sql']){
  const label={json:'JSON File',db:'Database File',zip:'ZIP Archive',sql:'SQL File'}[format];await page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim().startsWith(label)),{timeout:5000},label).catch(async e=>{console.log(await page.evaluate(()=>document.body.innerText));await page.screenshot({path:join(out,'backup-ui-failure.png'),fullPage:true});throw e;});await page.evaluate(label=>[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&b.textContent.trim().startsWith(label)).at(-1).click(),label);await new Promise(r=>setTimeout(r,200));
  const file=await download(()=>click({json:'Download Clinic Backup',db:'Download Clinic Database',zip:'Download ZIP Archive',sql:'Download Clinic SQL'}[format])).catch(async e=>{console.log(await page.evaluate(()=>document.body.innerText));await page.screenshot({path:join(out,'backup-ui-failure.png'),fullPage:true});throw e;});
  assert.deepEqual((await parse(file)).data.finance_state,snapshot.data.finance_state);
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());
 }
 await page.screenshot({path:join(out,'backup-en-clinic-settings.png'),fullPage:true});
 pass('Independent clinic settings UI exports all four formats with the complete ledger');
 const input=await page.$('input[type=file]');await input.uploadFile(exported[0].file.path);await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&/نعم، متأكد|Yes,.*sure|Confirm|Yes, confirm/i.test(b.textContent)));await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&/نعم، متأكد|Yes,.*sure|Confirm|Yes, confirm/i.test(b.textContent)).click());await page.waitForFunction(()=>document.body.innerText.includes('Backup restored successfully.')&&document.body.innerText.includes('Current passwords and staff access were kept.'));await page.screenshot({path:join(out,'backup-en-restore-success.png'),fullPage:true});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());assert.deepEqual((await backup(source,'export_clinic')).data.finance_state,snapshot.data.finance_state);
 pass('Actual clinic upload/confirmation/restore UI succeeds without erasing or duplicating history');
 await page.evaluateOnNewDocument(()=>localStorage.setItem('i18nextLng','ar'));await page.reload({waitUntil:'networkidle2'});await click('الإعدادات');await click('النسخ الاحتياطي');
 await (await page.$('input[type=file]')).uploadFile(exported[0].file.path);await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&/نعم، متأكد|Yes,.*sure|Confirm|Yes, confirm/i.test(b.textContent)));await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&/نعم، متأكد|Yes,.*sure|Confirm|Yes, confirm/i.test(b.textContent)).click());await page.waitForFunction(()=>document.body.innerText.includes('تم الاحتفاظ بكلمات المرور وصلاحيات الموظفين الحالية.'));await new Promise(r=>setTimeout(r,250));
 await page.screenshot({path:join(out,'backup-ar-restore-success.png'),fullPage:true});await page.setViewport({width:390,height:844});await page.screenshot({path:join(out,'backup-ar-restore-mobile.png'),fullPage:false});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());await page.setViewport({width:1440,height:1050});
 pass('Actual Arabic and English restore result notes explain current-password preservation and backup-date recovered credentials; Arabic phone layout captured');
 await page.evaluateOnNewDocument(t=>{localStorage.setItem('dental_auth_token',t);localStorage.setItem('dental_saas_session',JSON.stringify({type:'admin'}));localStorage.setItem('auto_backup_admin_last_date',new Date().toISOString().slice(0,10));},admin);await page.reload({waitUntil:'networkidle2'});await click('المتابعة بوضع المحاكاة المحلي');await click('النسخ الاحتياطي والاستعادة');
 for(const format of ['json','db','zip','sql']){
  const labels={json:'JSON (.json)',db:'DB Archive (.db)',zip:'ZIP (.zip)',sql:'SQL Dump (.sql)'};await click(labels[format]);const file=await download(()=>page.$eval('#btn-download-full-system-backup',b=>b.click()));const payload=await parse(file);assert.deepEqual(payload.clinics.find(c=>c.clinicInfo.id===cid).finance_state,snapshot.data.finance_state);await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());
 }
 const select=await page.$('select');await select.select(cid);const single=await download(()=>click('تنزيل نسخة العيادة المختارة'));assert.deepEqual((await parse(single)).data.finance_state,snapshot.data.finance_state);await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());
 await page.screenshot({path:join(out,'backup-ar-admin.png'),fullPage:true});
 const adminInput=await page.$('input[type=file]');await adminInput.uploadFile(exported[2].file.path);await page.type('input[placeholder="اكتب RESTORE للتأكيد"]','RESTORE');await click('تأكيد واستعادة البيانات الآن');await page.waitForFunction(()=>document.body.innerText.includes('Backup restored with financial history.')&&document.body.innerText.includes('Current passwords and staff access were kept.'));await new Promise(r=>setTimeout(r,250));await page.screenshot({path:join(out,'backup-ar-admin-restore-success.png'),fullPage:true});await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());
 pass('Actual admin full-system UI exports all formats; selected-clinic download and ZIP upload with typed RESTORE retain history');
 await click('العيادات المشتركة');await page.waitForSelector('button[title="تنزيل نسخة احتياطية خاصة ببيانات هذه العيادة"]');const listFile=await download(()=>page.evaluate(cid=>{const rows=[...document.querySelectorAll('tr')];const row=rows.find(r=>r.textContent.includes('عيادة اختبار الاستعادة'));const buttons=[...(row||document).querySelectorAll('button[title="تنزيل نسخة احتياطية خاصة ببيانات هذه العيادة"]')];buttons[0].click();},cid));assert.deepEqual((await parse(listFile)).data.finance_state,snapshot.data.finance_state);await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&['OK','Okay','حسناً'].includes(b.textContent.trim()))?.click());
 pass('Clinic-list instant backup also exports the authoritative financial state');

 assert.deepEqual(pageErrors,[]);
 await writeFile(join(out,'backup-results.json'),JSON.stringify({tests,formats:['JSON','DB','ZIP','SQL'],ledgerCounts:{receipts:snapshot.data.finance_state.receipts.length,events:snapshot.data.finance_state.events.length,requests:Object.keys(snapshot.data.finance_state.requests).length,assignments:Object.keys(snapshot.data.finance_state.assignments).length},limits:['Local isolated databases, not live PostgreSQL','Whole-system import is atomic per clinic, not one transaction across every clinic','Old backups cannot recover ledger history they never contained','Credential hashes are included by explicit user request; plaintext and session-signing secrets remain excluded']},null,2));
}finally{if(browser)await browser.close();await source.close();await rm('dist/backup-test-module.js',{force:true});}
