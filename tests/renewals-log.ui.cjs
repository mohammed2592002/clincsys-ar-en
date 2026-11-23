const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const base=process.env.TEST_BASE;
 const login=await fetch(base+'/api/superadmin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@crowndent.com',password:'admin123'})}).then(r=>r.json());assert(login.token);
 const headers={'content-type':'application/json',authorization:'Bearer '+login.token};
 const db=async(action,path,id,data)=>{const r=await fetch(base+'/api/db',{method:'POST',headers,body:JSON.stringify({action,path,id,data})});assert(r.ok,await r.text());};
 await db('setDoc','clinics','syn_renewal',{id:'syn_renewal',name:'عيادة الاختبار / Test Clinic',synthetic:true,isActive:true,subscriptionExpiresAt:'2028-01-01T00:00:00.000Z'});
 for(let i=0;i<25;i++)await db('setDoc','renewals','syn_ren_'+String(i).padStart(3,'0'),{clinicId:'syn_renewal',clinicName:i<12?'عيادة ألف / Alpha Clinic':i===24?'100%_Clinic':'عيادة بيتا / Beta Clinic',renewedAt:'2026-11-23T10:00:00.000Z',oldExpiry:'2027-01-01T00:00:00.000Z',newExpiry:'2028-01-01T00:00:00.000Z',amount:100,paymentMethod:'cash',notes:'Synthetic test',synthetic:true});
 const latestRestore=await fetch(base+'/api/system-restore',{headers});assert.equal(latestRestore.status,404,'new local database must not inherit another test database restore report');
 const get=async q=>fetch(base+'/api/superadmin/renewals'+q,{headers}).then(r=>r.json());
 const single=await fetch(base+'/api/backups',{method:'POST',headers,body:JSON.stringify({action:'export_clinic',clinicId:'syn_renewal'})});assert(single.ok,'single-clinic API retained');assert((await single.json()).clinicInfo,'single-clinic export payload intact');
 const initial=await get('');assert.equal(initial.items.length,10);assert.equal(initial.total,25);assert.equal(initial.totalRevenue,2500);
 const tail=await get('?offset=20');assert.equal(tail.items.length,5);assert(!tail.hasMore);
 const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage();let errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),body:r.postData()});});
 await page.setViewport({width:1440,height:1400});
 await page.evaluateOnNewDocument(token=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'admin'}));if(!localStorage.getItem('i18nextLng'))localStorage.setItem('i18nextLng','ar');localStorage.setItem('auto_backup_admin_last_date',new Date().toISOString().slice(0,10));},login.token);
 const click=async text=>{await page.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.includes(t)),{},text);await page.evaluate(t=>{let b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes(t));b.scrollIntoView({block:'center'});b.click();},text);};
 const count=async n=>{try{await page.waitForFunction(n=>document.querySelectorAll('[data-renewal-row]').length===n,{timeout:10000},n);}catch(e){console.error('COUNT wanted',n,'body',await page.$eval('[data-renewals-log]',e=>e.innerText),'requests',requests.slice(-6));throw e;}};
 const input=async value=>{await page.$eval('[data-renewals-log] input', (el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);};
 const dismiss=async()=>{if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.includes('المتابعة بوضع'))))await click('المتابعة بوضع');await sleep(300);};
 const shot=async name=>{await dismiss();await page.$eval('[data-renewals-log]',e=>window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-115));await sleep(200);await page.screenshot({path:'/downloads/'+name+'.png',fullPage:false});if(name.includes('mobile')){await page.$eval('[data-renewals-more]',e=>e.scrollIntoView({block:'end',behavior:'instant'}));await sleep(900);await page.screenshot({path:'/downloads/'+name+'-more.png'});}};
 await page.goto(base+'/login',{waitUntil:'networkidle2'});await sleep(1200);
 if(await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes('المتابعة'))))await click('المتابعة');
 requests=[];await click('سجل التجديدات');await count(10);assert.equal(await page.$eval('[data-renewals-counter]',e=>e.textContent),'يظهر 10 من 25 عملية');
 assert(!requests.some(r=>{try{const b=JSON.parse(r.body);return b.action==='getDocs'&&b.path==='renewals';}catch{return false;}}),'no full log collection request');
 await shot('renewals-ar-desktop');await page.click('[data-renewals-more]');await count(20);await page.click('[data-renewals-more]');await count(25);assert.equal(await page.$('[data-renewals-more]'),null);assert.equal(new Set(await page.$$eval('[data-renewal-row]',els=>els.map(e=>e.dataset.renewalRow))).size,25);
 await input('Alpha');await count(10);await page.waitForFunction(()=>document.querySelector('[data-renewals-counter]').textContent.includes('12'));assert.equal((await get('?q=Alpha')).totalRevenue,1200);await page.click('[data-renewals-more]');await count(12);
 await input('missing clinic');await count(0);await page.waitForFunction(()=>document.querySelector('[data-renewals-counter]').textContent.includes('0 من 0'));await shot('renewals-empty');
 await input('');await count(10);
 // A failed next-page request preserves rows and can be retried.
 await page.setRequestInterception(true);let fail=true;const interceptor=r=>{if(r.isInterceptResolutionHandled())return;if(fail&&r.url().includes('/api/superadmin/renewals?offset=10')){fail=false;r.respond({status:500,contentType:'application/json',body:'{}'});}else r.continue();};page.on('request',interceptor);
 await page.click('[data-renewals-more]');await page.waitForFunction(()=>document.querySelector('[data-renewals-log]').innerText.includes('تعذر تحميل'));await count(10);await page.click('[data-renewals-more]');await count(20);page.off('request',interceptor);await page.setRequestInterception(false);
 await input('Alpha');await count(10);const id=await page.$eval('[data-renewal-row]',el=>el.dataset.renewalRow);await page.click('[data-renewal-row] button');await click('نعم، احذف التجديد واسترجع التاريخ');await page.waitForFunction(()=>document.body.innerText.includes('تم حذف التجديد واسترجاع'));await click('حسناً');
 await page.waitForFunction(()=>document.querySelector('[data-renewals-counter]').textContent.includes('11'));
 assert.equal((await get('?q=Alpha')).total,11);assert.equal((await get('?q=Alpha')).totalRevenue,1100);assert(!(await get('?q=Alpha')).items.some(r=>r.id===id));
 const clinicResponse=await fetch(base+'/api/db',{method:'POST',headers,body:JSON.stringify({action:'getDoc',path:'clinics',id:'syn_renewal'})}).then(r=>r.json());assert.equal(clinicResponse.subscriptionExpiresAt,'2027-01-01T00:00:00.000Z');
 await input('');await count(10);await page.setViewport({width:390,height:844});await shot('renewals-ar-mobile');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile page overflow');
 await page.evaluate(()=>localStorage.setItem('i18nextLng','en'));await page.reload({waitUntil:'networkidle2'});await dismiss();await click('سجل التجديدات');await count(10);await page.waitForFunction(()=>document.querySelector('[data-renewals-log]').innerText.includes('Show more'));await shot('renewals-en-mobile');await page.setViewport({width:1440,height:1400});await shot('renewals-en-desktop');
 await page.click('[data-renewals-more]');await count(20);await input('Alpha');await count(10);await page.waitForFunction(()=>document.querySelector('[data-renewals-counter]').textContent.includes('of 11'));
 for(const lang of ['en','ar']){await page.evaluate(l=>localStorage.setItem('i18nextLng',l),lang);await page.reload({waitUntil:'networkidle2'});await dismiss();await click('النسخ الاحتياطي والاستعادة');await page.waitForFunction(()=>document.body.innerText.includes('.json.gz'));await sleep(5500);assert(!await page.evaluate(()=>document.body.innerText.includes('Restore failed')||document.body.innerText.includes('فشلت الاستعادة')),'clean page has no failed restore chip after polling and refresh');for(const width of [1440,390]){await page.setViewport({width,height:1000});await sleep(500);await dismiss();assert.equal(await page.$('select'),null,'per-clinic select removed');assert(await page.$('input[type=file]'),'restore upload remains');await page.screenshot({path:`/downloads/backup-no-clinic-${lang}-${width}.png`,fullPage:true});}}
 assert.deepEqual(errors,[]);console.log('PASS UI + API: 10/20/25 append, no full log fetch, server search + global totals, no duplicates, empty state, failure/retry, real delete + expiry revert + count/revenue refresh, AR/EN desktop/mobile, no horizontal page overflow, backup card absent with restore intact, zero page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
