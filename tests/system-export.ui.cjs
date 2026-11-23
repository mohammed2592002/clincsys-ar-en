const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const zlib=require('node:zlib');const puppeteer=require('puppeteer-core');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const base=process.env.TEST_BASE;const auth=await fetch(base+'/api/superadmin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@crowndent.com',password:'admin123'})}).then(r=>r.json());assert(auth.token);
 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-backup-'));
 try{
 const page=await browser.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.evaluateOnNewDocument(token=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'admin'}));if(!localStorage.getItem('i18nextLng'))localStorage.setItem('i18nextLng','ar');localStorage.setItem('auto_backup_admin_last_date',new Date().toISOString().slice(0,10));const original=Response.prototype.blob;Response.prototype.blob=function(){throw Error('Blob buffering forbidden in native export test');};},auth.token);
 const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,eventsEnabled:true});
 const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.includes(t)),{},text);await page.evaluate(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes(t));b.scrollIntoView({block:'center'});b.click();},text);};
 for(const [lang,width] of [['ar',1440],['en',390]]){
  await page.setViewport({width,height:1000});await page.goto(base+'/login',{waitUntil:'networkidle2'});await page.evaluate(l=>localStorage.setItem('i18nextLng',l),lang);await page.reload({waitUntil:'networkidle2'});await sleep(800);
  if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('المتابعة بوضع'))))await click('المتابعة بوضع');
  await click('النسخ الاحتياطي والاستعادة');await page.waitForFunction(()=>document.body.innerText.includes('.json.gz'));
  requests.length=0;for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));const before=new Set();
  await click(lang==='ar'?'تنزيل النسخة الاحتياطية الشاملة':'Download the full system backup');
  await page.waitForFunction(text=>document.body.innerText.includes(text),{timeout:60000},lang==='ar'?'النسخة جاهزة وبدأ التنزيل':'Backup is ready and the download started');
  let file;for(let i=0;i<50;i++){file=fs.readdirSync(dir).find(f=>f.endsWith('.json.gz')&&!before.has(f));if(file)break;await sleep(100);}assert(file,'browser download manager saved a real attachment');
  const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,file))));assert.equal(data.backupScope,'FULL_SYSTEM_BACKUP');assert(data.superadminCredentials[0].password.startsWith('scrypt$'));assert(data.clinics.length>0);
  assert(requests.some(u=>u.includes('/api/system-backup/ticket')));assert(!requests.some(u=>u.includes('?token=')||u.includes(auth.token)));
  await sleep(500);await page.screenshot({path:`/downloads/export-native-${lang}-${width}.png`,fullPage:false});
  await click(lang==='ar'?'حسناً':'OK');
 }
 assert.deepEqual(errors,[]);console.log('PASS native Chrome download: desktop Arabic + mobile viewport English, real gzip saved, no Response.blob, short-lived link without auth token, truthful completion wording, zero page errors.');
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
