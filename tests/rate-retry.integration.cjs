const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const base=process.env.TEST_BASE;
(async()=>{
 const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());
 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();await page.goto(base+'/robots.txt');await page.addScriptTag({path:process.env.OFFLINE_TEST_BUNDLE});
  const result=await page.evaluate(async({token,cid})=>{
   OfflineAudit.setAuthToken(token);const original=window.fetch;let throttled=true,sends=0;
   window.fetch=async(...args)=>{const b=JSON.parse(args[1]?.body||'{}');if(args[0]==='/api/finance'&&b.table==='patients'){sends++;if(throttled)return new Response('not json',{status:429,headers:{'Retry-After':'1'}});}return original(...args);};
   const ref=OfflineAudit.collection(OfflineAudit.db,'clinics',cid,'patients');const write=await OfflineAudit.addDoc(ref,{name:'Rate retry fixture'});
   let pending=await OfflineAudit.getPendingCommands();const saved={pending:write.pending,count:pending.length,status:pending[0].status,http:pending[0].lastHttpStatus,id:pending[0].id};
   await OfflineAudit.flushDurableCommands();const immediate=sends;
   throttled=false;await new Promise(r=>setTimeout(r,1100));await OfflineAudit.flushDurableCommands();
   pending=await OfflineAudit.getPendingCommands();const read=await OfflineAudit.getDoc(OfflineAudit.doc(ref,write.id),true);
   return {saved,immediate,sends,pending:pending.length,name:read.data()?.name};
  },{token:login.token,cid:login.clinic.id});
  assert.equal(result.saved.pending,true);assert.equal(result.saved.count,1);assert.equal(result.saved.status,'pending');assert.equal(result.saved.http,429);assert.equal(result.immediate,1);assert.equal(result.sends,2);assert.equal(result.pending,0);assert.equal(result.name,'Rate retry fixture');
  const recovered=await page.evaluate(async()=>{
   const token=OfflineAudit.getAuthToken();const identity=JSON.parse(atob(token.split('.')[1]));const cid=identity.clinicId;
   const owner=[identity.type,cid,identity.staffId||''].join(':');
   const body={action:'write',table:'patients',id:'legacy-rate',data:{name:'Legacy rate recovery'},optimistic:true,localPath:'clinics/'+cid+'/patients'};
   await OfflineAudit.saveCommand({id:crypto.randomUUID(),owner,clinicId:cid,body,fingerprint:'legacy-rate',screen:'patients',createdAt:new Date().toISOString(),status:'conflict',error:'طلبات كثيرة جداً، يرجى المحاولة بعد قليل',financial:false,localId:'legacy-rate',localPath:body.localPath});
   const real={id:crypto.randomUUID(),owner,clinicId:cid,body:{...body,id:'real-conflict'},fingerprint:'real-conflict',screen:'patients',createdAt:new Date().toISOString(),status:'conflict',error:'تعارض تعديل',financial:false,localId:'real-conflict',localPath:body.localPath};
   await OfflineAudit.saveCommand(real);OfflineAudit.setActiveRequestScreen('settings');
   await OfflineAudit.flushDurableCommands();const before=await OfflineAudit.getPendingCommands();
   await OfflineAudit.flushDurableCommands({manual:true});const after=await OfflineAudit.getPendingCommands();
   return {before:before.length,after:after.length,real:after[0]?.id===real.id,status:after[0]?.status};
  });
  assert.equal(recovered.before,2);assert.equal(recovered.after,1);assert(recovered.real);assert.equal(recovered.status,'conflict');
  console.log('PASS Sync now recovers identified legacy 429 conflicts across screen ownership; genuine conflicts remain for review');
  console.log('PASS malformed-body 429 persists optimistic save as pending, obeys Retry-After, retries same durable request once, confirms data');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
