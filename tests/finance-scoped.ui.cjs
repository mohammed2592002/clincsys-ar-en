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

// Payload reduction: the shift tab asks for zero appointment pages, and the
// summary card still renders the complete-set remaining total from the server.
await click(tabs[4]);
const shiftViews=requests.filter(b=>b.action==='view'&&b.scope==='shift');
assert(shiftViews.length>0&&shiftViews.every(b=>b.limit===0),'shift tab requests the light view (limit:0)');
const uiShiftBody=shiftViews[shiftViews.length-1];
const apiShift=await fetch(base+'/api/finance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify(uiShiftBody)}).then(r=>r.json());
assert(apiShift.shiftTotals,'server returns complete-set shift totals for the UI shift');
assert(apiShift.appointments.length<=apiShift.shiftTotals.completed+apiShift.shiftTotals.scheduled+apiShift.shiftTotals.cancelled,'light view rows are a small subset');
await page.waitForFunction((en)=>document.body.innerText.includes(en?'Total Collected (All Methods)':'المحصل كله بكل الطرق'),{},lang==='en');
await page.waitForFunction((label,value)=>{const spans=[...document.querySelectorAll('span')];const el=spans.find(s=>s.textContent.includes(label));return !!el&&el.closest('div').innerText.includes(value);},{},lang==='en'?'Installments & Due Balances':'الأقساط والمتبقي على المرضى',Number(apiShift.shiftTotals.remainingTotal).toLocaleString());

// Settlement coalescing: a four-event burst triggers exactly one settlement read.
const settleBefore=requests.filter(b=>b.action==='view'&&b.scope==='settlement').length;
await page.evaluate(()=>{for(const table of ['patients','appointments','shifts','expenses'])window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{table}}));});
await sleep(600);
assert.equal(requests.filter(b=>b.action==='view'&&b.scope==='settlement').length-settleBefore,1,'burst merges repeated settlement refreshes into one');

// Installments: grouped server pagination drives the patient count card.
await click(tabs[2]);
await click(lang==='en'?'All':'الكل');
await sleep(500);
const apiInst=await fetch(base+'/api/finance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify({clinicId:login.clinic.id,action:'view',scope:'installments',from:'',to:'',limit:50,search:''})}).then(r=>r.json());
assert(apiInst.installmentTotals&&typeof apiInst.installmentTotals.groupCount==='number','server returns installment group totals');
const instRequests=requests.filter(b=>b.action==='view'&&b.scope==='installments');
assert(instRequests.length>0&&instRequests.every(b=>typeof b.limit==='number'),'installments tab requests grouped pages');
await page.waitForFunction((count,en)=>document.body.innerText.includes(en?count+' patients with due installments':count+' مرضى عليهم أقساط مستحقة'),{},String(apiInst.installmentTotals.groupCount),lang==='en');

// Print report: the full appointment rows are fetched on demand only.
await click(tabs[4]);
const printViewsBefore=requests.filter(b=>b.action==='view'&&b.scope==='shift'&&b.includeAppointments===true).length;
await click(lang==='en'?'Print Report':'طباعة التقرير');
await sleep(700);
assert.equal(requests.filter(b=>b.action==='view'&&b.scope==='shift'&&b.includeAppointments===true).length-printViewsBefore,1,'printing loads the full shift rows on demand');
await page.waitForFunction(()=>document.body.innerText.includes('تفاصيل الحجوزات والمدفوعات')||document.body.innerText.includes('Shift Bookings & Patient Payments Details'));
await page.screenshot({path:'/downloads/finance-cache-'+lang+'.png',fullPage:true});
assert.deepEqual(errors,[]);
console.log('PASS '+lang+': warm tabs cached; light shift view with exact server totals; burst merges settlement to one read; installments grouped pagination drives the count card; print loads full rows on demand; no page errors.');
await page.close();
}
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
