const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
(async()=>{
const base=process.env.TEST_BASE;
const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
const page=await browser.newPage();const requests=[];
page.on('request',r=>{if(r.url().endsWith('/api/finance')&&r.postData()){const body=JSON.parse(r.postData());requests.push(body);}});
await page.evaluateOnNewDocument((token,cid)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:cid,clinicName:'Scoped test'}));localStorage.setItem('i18nextLng','en');},login.token,login.clinic.id);
await page.goto(base,{waitUntil:'networkidle2'});
await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Financials')||b.textContent.includes('Accounting')).click());
await page.waitForFunction(()=>document.body.innerText.includes('Daily Register Closing'));
await new Promise(r=>setTimeout(r,500));
assert.equal(requests.filter(b=>b.action==='read').length,0,'main screen must not request full finance read');
const before=requests.filter(b=>b.action==='view'&&b.scope==='shift').length;
await page.evaluate(()=>{for(const table of ['patients','appointments','shifts','expenses'])window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{table}}));});
await new Promise(r=>setTimeout(r,500));
assert.equal(requests.filter(b=>b.action==='view'&&b.scope==='shift').length-before,1,'one scoped refresh for a four-event burst');
console.log('PASS local rendered screen: no full finance read on entry; four sync events coalesced into one scoped refresh.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
