const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const base=process.env.TEST_BASE;
const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
for(const lang of ['ar','en']){
const page=await browser.newPage(),requests=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/api/finance')&&r.postData())requests.push(JSON.parse(r.postData()));});
await page.evaluateOnNewDocument((token,cid,language)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:cid,clinicName:'Scoped test'}));localStorage.setItem('i18nextLng',language);},login.token,login.clinic.id,lang);
await page.goto(base,{waitUntil:'networkidle2'});
const click=async text=>{await page.evaluate(t=>{const button=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes(t));if(!button)throw Error('Missing '+t);button.click();},text);await sleep(220);};
await click(lang==='en'?'Accounting':'الحسابات والمالية');
await sleep(400);
assert.equal(requests.filter(b=>b.action==='read').length,0,'no full ledger reads');
const tabs=lang==='en'?['Closing Archives & Logs','Revenue Analytics & Reports','Patient Installments & Balances','Clinic Expenses & Purchasing','Daily Register Closing']:['سجل الإقفال التاريخي','التقارير وتحليلات الإيرادات','المرضى والأقساط المستحقة','المصروفات والبنود المقتطعة','إقفال اليومية والوردية'];
for(const tab of tabs)await click(tab);
const warm=requests.length;
for(const tab of tabs)await click(tab);
assert.equal(requests.length,warm,'completed views and settlement must be reused on warm tab switches');
const before=requests.filter(b=>b.action==='view'&&b.scope==='shift').length;
await page.evaluate(()=>{for(const table of ['patients','appointments','shifts','expenses'])window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{table}}));});
await sleep(600);
assert.equal(requests.filter(b=>b.action==='view'&&b.scope==='shift').length-before,1,'one fresh shift read after a four-event burst, not a stale cached result');
await click(tabs[1]);
assert.equal(requests.filter(b=>b.action==='view'&&b.scope==='revenues').length,2,'inactive tab cache invalidated by sync');
await click(tabs[4]);const after=requests.length;
await click(tabs[1]);await click(tabs[4]);assert.equal(requests.length,after,'freshly reloaded tabs cache again');
await page.screenshot({path:'/downloads/finance-cache-'+lang+'.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('PASS '+lang+': zero finance requests on repeated warm tabs; settlement cached; burst invalidation refreshes once; inactive views reload then cache; no page errors.');
await page.close();
}
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
