const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const base=process.env.TEST_BASE;
(async()=>{
 const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());
 const token=login.token,cid=login.clinic.id;
 async function api(body){const r=await fetch(base+'/api/finance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({clinicId:cid,requestId:crypto.randomUUID(),...body})});return {status:r.status,data:await r.json()};}
 async function db(table,id){return fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'getDoc',path:`clinics/${cid}/${table}`,id})}).then(r=>r.json());}
 let checks=0;
 const failures=[];
 async function check(name,fn){checks++;try{await fn();console.log('PASS '+name);}catch(e){failures.push(name);console.log('FAIL '+name+': '+e.message);}}
 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage();
 await page.goto(base+'/robots.txt');
 await page.addScriptTag({path:process.env.OFFLINE_TEST_BUNDLE});
 await page.evaluate(t=>OfflineAudit.setAuthToken(t),token);

 await check('super admin settings do not claim success when the server rejects the write',async()=>{
   const denied=await page.evaluate(async()=>{try{await OfflineAudit.setDoc(OfflineAudit.doc(OfflineAudit.db,'system_settings','support'),{phoneNumbers:[],socialLinks:[]});return false;}catch{return true;}});
   assert(denied,'manager must not get an optimistic success for global admin settings');
 });
 await check('same-device sequential saves ignore server timestamps and object key order',async()=>{
   await api({action:'write',table:'patients',id:'semantic',data:{name:'Semantic test',toothChart:{'16':{condition:'filling',cost:600}},updatedAt:'2026-11-21T12:00:00.000Z'}});
   const old=await db('patients','semantic');
   const result=await api({action:'write',table:'patients',id:'semantic',base:{toothChart:{'16':{cost:600,condition:'filling'}},updatedAt:'2026-11-21T12:00:00.000Z'},data:{toothChart:{'16':{cost:600,condition:'filling'}},updatedAt:'2026-11-21T12:00:00.045Z'}});
   assert.equal(result.status,200,JSON.stringify(result.data));
   const conflict=await api({action:'write',table:'patients',id:'semantic',base:{name:'old incorrect name'},data:{name:'must not overwrite'}});
   assert.equal(conflict.status,409,'real field conflict must remain protected');
 });
 await check('sequential offline edits rebase only their own acknowledged predecessor',async()=>{
   await page.setOfflineMode(true);
   await page.evaluate(async cid=>{const ref=OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','offline-sequential');await OfflineAudit.setDoc(ref,{name:'First'});await OfflineAudit.updateDoc(ref,{name:'Second',updatedAt:new Date().toISOString()});},cid);
   await page.setOfflineMode(false);await page.evaluate(()=>OfflineAudit.flushDurableCommands());
   const pending=await page.evaluate(()=>OfflineAudit.getPendingCommands());
   assert.equal(pending.length,0,JSON.stringify(pending));
   assert.equal((await db('patients','offline-sequential')).name,'Second');
 });

 await check('dependent delete resumes after keep-server review and reports history rejection',async()=>{
   await api({action:'write',table:'patients',id:'blocked-delete',data:{name:'Protected',phone:'old'}});
   await api({action:'write',table:'appointments',id:'blocked-history',data:{patientId:'blocked-delete',patientName:'Protected',price:0,status:'scheduled'}});
   await page.evaluate(async cid=>{await OfflineAudit.getDoc(OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','blocked-delete'),true);},cid);
   await api({action:'write',table:'patients',id:'blocked-delete',data:{phone:'server'}});
   await page.evaluate(async cid=>{try{await OfflineAudit.updateDoc(OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','blocked-delete'),{phone:'local'});}catch{}try{await OfflineAudit.deleteDoc(OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','blocked-delete'));}catch{}},cid);
   const pending=await page.evaluate(()=>OfflineAudit.getPendingCommands());
   const edit=pending.find(c=>c.body.action==='write'&&c.body.id==='blocked-delete');assert.equal(edit.status,'conflict');
   await page.evaluate(async id=>{const review=await OfflineAudit.reviewDurableCommand(id);await OfflineAudit.resolveDurableCommand(id,'server',review.current);},edit.id);
   const after=await page.evaluate(()=>OfflineAudit.getPendingCommands());
   const deletion=after.find(c=>c.body.action==='delete'&&c.body.id==='blocked-delete');
   assert.equal(deletion.status,'conflict');assert(deletion.error.includes('لا يمكن حذف'));
   assert.equal((await db('patients','blocked-delete')).phone,'server');
 });
 await check('refund reverses earned points proportionally and fully, idempotent retry',async()=>{
   await api({action:'write',table:'patients',id:'refund-p',data:{name:'Refund',loyaltyPoints:0}});
   await api({action:'write',table:'appointments',id:'refund-a',data:{patientId:'refund-p',patientName:'Refund',price:600,status:'completed',date:'2026-11-21'}});
   await api({action:'open',startCash:0});
   const payment=(await api({action:'collect',appointmentId:'refund-a',amount:200,paymentMethod:'cash'})).data;
   assert.equal((await db('patients','refund-p')).loyaltyPoints,40);
   const refund={action:'refund',appointmentId:'refund-a',receiptId:payment.receipt.id,amount:75,reason:'Partial regression',requestId:crypto.randomUUID()};
   assert.equal((await api(refund)).status,200);await api(refund);
   assert.equal((await db('patients','refund-p')).loyaltyPoints,25);
   assert.equal((await api({...refund,requestId:crypto.randomUUID(),amount:125})).status,200);
   assert.equal((await db('patients','refund-p')).loyaltyPoints,0);
 });

 await check('spent reward points become points debt after refund instead of free rewards',async()=>{
   await api({action:'write',table:'patients',id:'refund-debt-p',data:{name:'Reward debt',loyaltyPoints:0}});
   await api({action:'write',table:'appointments',id:'refund-debt-a',data:{patientId:'refund-debt-p',patientName:'Reward debt',price:600,status:'completed'}});
   const collect=(await api({action:'collect',appointmentId:'refund-debt-a',amount:200,paymentMethod:'cash'})).data;
   assert.equal((await api({action:'points',appointmentId:'refund-debt-a',amount:20})).status,200);
   assert.equal((await api({action:'refund',appointmentId:'refund-debt-a',receiptId:collect.receipt.id,amount:200,reason:'Spent rewards regression'})).status,200);
   assert.equal((await db('patients','refund-debt-p')).loyaltyPoints,-20);
 });
 await check('PNG and JPEG decode and compression with installed service worker',async()=>{
   await page.goto(base,{waitUntil:'networkidle2'});
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
   await page.reload({waitUntil:'networkidle2'});
   await page.addScriptTag({path:process.env.OFFLINE_TEST_BUNDLE});
   const result=await page.evaluate(async()=>{const out=[];for(const type of ['image/png','image/jpeg']){const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='gray';ctx.fillRect(0,0,320,240);const blob=await new Promise(r=>c.toBlob(r,type));try{const f=new File([blob],'xray.'+(type.endsWith('png')?'png':'jpg'),{type});const compressed=await OfflineAudit.compressImage(f);const img=new Image();img.src=compressed.compressedDataUrl;await img.decode();out.push({type,ok:true,width:img.width});}catch(e){out.push({type,ok:false,error:e.message});}}return out;});
   assert(result.every(r=>r.ok),JSON.stringify(result));
 });

 await check('valid image fallback when blob URLs fail; corrupt bytes still reject',async()=>{
   const out=await page.evaluate(async()=>{
     const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;
     const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
     const original=URL.createObjectURL;URL.createObjectURL=()=> 'blob:' + location.origin + '/unavailable-decoder-test';
     try{const result=await OfflineAudit.compressImage(new File([blob],'valid.png',{type:'image/png'}));let rejected=false;try{await OfflineAudit.compressImage(new File(['not image bytes'],'broken.png',{type:'image/png'}));}catch{rejected=true;}return {ok:result.compressedDataUrl.startsWith('data:image/'),rejected};}finally{URL.createObjectURL=original;}
   });assert(out.ok&&out.rejected,JSON.stringify(out));
 });

 await check('real PNG/JPEG bytes upload, save to xray record, and reload from isolated server storage',async()=>{
   const out=await page.evaluate(async cid=>{const list=[];for(const type of ['image/png','image/jpeg']){
     const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,320,240);gradient.addColorStop(0,'#203040');gradient.addColorStop(1,'#708090');ctx.fillStyle=gradient;ctx.fillRect(0,0,320,240);ctx.fillStyle='white';ctx.font='bold 20px sans-serif';ctx.fillText(type.toUpperCase()+' TEST',25,35);ctx.strokeStyle='#ddd';ctx.lineWidth=9;for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(50+i*50,70);ctx.lineTo(60+i*50,190);ctx.stroke();}
     const blob=await new Promise(r=>canvas.toBlob(r,type));const file=new File([blob],'scan.'+(type.endsWith('png')?'png':'jpg'),{type});
     const compressed=await OfflineAudit.compressImage(file);const form=new FormData();form.append('file',compressed.file);form.append('clinicId',cid);form.append('category','xrays');
     const response=await fetch('/api/upload',{method:'POST',headers:OfflineAudit.authHeaders(),body:form});if(!response.ok)throw Error(await response.text());const uploaded=await response.json();
     const id='image-roundtrip-'+type.split('/')[1];await OfflineAudit.setDoc(OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','refund-p','xrays',id),{patientId:'refund-p',imageUrl:uploaded.publicUrl});
     const stored=(await OfflineAudit.getDoc(OfflineAudit.doc(OfflineAudit.db,'clinics',cid,'patients','refund-p','xrays',id),true)).data();const img=new Image();img.src=OfflineAudit.resolveMediaPreview?await OfflineAudit.resolveMediaPreview(stored.imageUrl):stored.imageUrl;await img.decode();list.push({type,width:img.width,height:img.height,mode:uploaded.mode});
   }return list;},cid);
   assert(out.every(r=>r.width===320&&r.height===240&&r.mode==='local'),JSON.stringify(out));
 });
 for(let i=0;i<10;i++)await api({action:'write',table:'patients',id:'analytics-'+i,data:{name:'Analytics '+i,createdAt:'2026-11-20T10:00:00Z',governorate:i<5?'القاهرة':'الجيزة',medicalHistory:i<3?'ضغط':'سليم'}});
 const ui=await browser.newPage();await ui.setViewport({width:1440,height:1000});
 await ui.evaluateOnNewDocument((token,cid)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:cid,clinicName:'Isolated regression'}));localStorage.setItem('i18nextLng','ar');localStorage.setItem('auto_backup_last_date_'+cid,new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date()));},token,cid);
 await ui.goto(base,{waitUntil:'networkidle2'});
 const click=async text=>{await ui.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.includes(text)),{},text);await ui.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes(text)).click(),text);await new Promise(r=>setTimeout(r,400));};
 await check('analytics keeps full-clinic totals after sync without Load More',async()=>{
   await click('إدارة المرضى');await click('التحليل الجغرافي');
   const total=await fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'getDocs',path:`clinics/${cid}/patients`})}).then(r=>r.json()).then(a=>a.length);
   await new Promise(r=>setTimeout(r,1200));
   await ui.evaluate(()=>window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{table:'patients'}})));
   await new Promise(r=>setTimeout(r,1200));
   const actual=await ui.evaluate(()=>{const el=[...document.querySelectorAll('span')].find(el=>el.textContent==='إجمالي المرضى بالعيادة');return el?.closest('.bg-white')?.querySelector('p')?.textContent;});
   await ui.screenshot({path:'/downloads/analytics-'+(process.env.BASELINE?'before':'after')+'.png',fullPage:true});
   assert.equal(parseInt(actual),total,'analytics after sync must not fall back to the 5 loaded rows: '+actual);
 });
 await check('unconfigured support link is hidden and current admin settings replace cached settings',async()=>{
   await ui.setRequestInterception(true);let phase=1;
   ui.on('request',req=>{let body;try{body=JSON.parse(req.postData()||'{}');}catch{}if(req.url().endsWith('/api/db')&&body?.path?.startsWith('system_settings')&&body?.id==='support'&&body.action==='getDoc')req.respond({status:200,contentType:'application/json',body:JSON.stringify({id:'support',phoneNumbers:[{id:'test',phone:phase===1?'01011112222':'01033334444',title:'Configured test support'}],socialLinks:phase===1?[{id:'tg',platform:'telegram',url:'',title:'Empty Telegram'}]:[{id:'tg',platform:'telegram',url:'@RegressionTest',title:'Configured Telegram'}]})});else req.continue();});
   await click('الإعدادات');await click('الدعم الفني');await new Promise(r=>setTimeout(r,600));
   const first=await ui.evaluate(()=>({empty:[...document.querySelectorAll('a')].some(a=>a.textContent.includes('Empty Telegram')),phone:document.body.innerText.includes('01011112222')}));
   await ui.screenshot({path:'/downloads/support-'+(process.env.BASELINE?'before':'after')+'.png',fullPage:true});
   assert(!first.empty&&first.phone,JSON.stringify(first));
   phase=2;await click('إدارة المرضى');await click('الإعدادات');await click('الدعم الفني');await new Promise(r=>setTimeout(r,700));
   const second=await ui.evaluate(()=>({href:[...document.querySelectorAll('a')].find(a=>a.textContent.includes('Configured Telegram'))?.getAttribute('href'),phone:document.body.innerText.includes('01033334444')}));
   await ui.screenshot({path:'/downloads/support-'+(process.env.BASELINE?'before':'after')+'.png',fullPage:true});
   assert.equal(second.href,'https://t.me/RegressionTest');assert(second.phone);
 });

 await check('medical file renders both uploaded X-rays after reopening the saved patient',async()=>{
   await click('إدارة المرضى');
   await ui.waitForSelector('input[placeholder*="المحافظة"]');
   await ui.type('input[placeholder*="المحافظة"]','Refund');
   await ui.waitForFunction(()=>[...document.querySelectorAll('tr')].some(tr=>tr.innerText.includes('Refund')));
   await ui.evaluate(()=>{const row=[...document.querySelectorAll('tr')].find(tr=>tr.innerText.includes('Refund'));[...row.querySelectorAll('button')].find(b=>b.textContent.includes('الملف الطبي')).click();});
   await click('الأشعة');
   await ui.waitForFunction(()=>[...document.querySelectorAll('img[alt="أشعة مريض"]')].filter(img=>img.complete&&img.naturalWidth>0).length===2);
   await ui.evaluate(()=>document.querySelector('img[alt="أشعة مريض"]').scrollIntoView({block:'center'}));
   await ui.screenshot({path:'/downloads/xray-after.png',fullPage:false});
 });
 await ui.close();
 }finally{await browser.close();}
 console.log('LIVE BUG REGRESSION SUMMARY: '+(checks-failures.length)+'/'+checks+' passed');
 if(failures.length&&!process.env.BASELINE)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
