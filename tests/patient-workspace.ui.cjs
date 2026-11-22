const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const {mkdirSync,writeFileSync}=require('node:fs');
const base=process.env.TEST_BASE,cid='finance_isolated_test',lang=process.env.TEST_LANG||'ar',en=lang==='en';
const artifacts=process.env.TEST_ARTIFACT_DIR||'/downloads/patient-file-proof';mkdirSync(artifacts,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'finance-isolated@example.invalid',password:'test-only-password',role:'manager'})}).then(r=>r.json());assert(login.token);
const api=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify(body)});const out=await r.json();assert.equal(r.status,200,JSON.stringify(out));return out;};
const db=(action,path,id,data)=>api('/api/db',{action,path,id,data});
const fin=body=>api('/api/finance',{clinicId:cid,requestId:crypto.randomUUID(),...body});
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date()),date=new Date().toISOString();
const pname=en?'Patient Workspace Test':'مريض اختبار الملف الطبي';
await db('updateDoc','clinics/'+cid,cid,{questionnaireQuestions:[{id:'db_allergy',text:en?'Database-defined allergy question':'سؤال الحساسية من قاعدة البيانات',category:en?'Drug allergy':'حساسية أدوية',type:'yesno'}],loyaltyProgramEnabled:true});
await db('setDoc',`clinics/${cid}/patients`,'workspace_patient',{name:pname,phone:'01000000000',age:'36',gender:'ذكر',occupation:en?'Engineer':'مهندس',governorate:'القاهرة',cityOrDistrict:'مصر الجديدة',loyaltyPoints:0,createdAt:date,updatedAt:date,doctorNotes:[],questionnaire:{customAnswers:{db_allergy:{answer:'نعم',details:'DB-only clinical detail'}},generalNotes:'Reception detail retained'}});
await db('setDoc',`clinics/${cid}/patients`,'empty_patient',{name:'Other Empty Patient',phone:'01000000001',createdAt:'2020-01-01'});
await db('setDoc',`clinics/${cid}/appointments`,'workspace_app',{patientId:'workspace_patient',patientName:pname,date:today,time:'10:00',price:800,paidAmount:0,remainingAmount:800,status:'completed',treatmentType:'Composite DB Procedure',procedures:[{name:'Composite DB Procedure',price:800,tooth:16}]});
await db('setDoc',`clinics/${cid}/patients/workspace_patient/records`,'workspace_record',{patientId:'workspace_patient',date:date,treatment:'Composite DB Procedure',cost:800,toothNumber:16,appointmentId:'workspace_app',procedures:[{name:'Composite DB Procedure',price:800,tooth:16}],notes:'Visit-specific DB note'});
await db('setDoc',`clinics/${cid}/prescriptions`,'workspace_rx',{patientId:'workspace_patient',patientName:pname,patientAge:'36',date,medications:[{name:'Database Medication',dose:'1 tablet',frequency:'Every 12 hours',duration:'5 days'}],notes:'Saved RX advice'});
await fin({action:'open',date:today,startCash:0});
await fin({action:'collect',appointmentId:'workspace_app',amount:300,paymentMethod:'cash'});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1050});
await page.evaluateOnNewDocument((token,clinic,language)=>{localStorage.setItem('dental_auth_token',token);localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:clinic.id,clinicName:clinic.name}));localStorage.setItem('i18nextLng',language);localStorage.setItem('auto_backup_last_date_'+clinic.id,new Date().toISOString().slice(0,10));},login.token,login.clinic,lang);
const click=async(text,exact=false)=>assert(await page.evaluate((t,x)=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&(x?b.textContent.trim()===t:b.textContent.includes(t)));b?.click();return !!b;},text,exact),'Missing button '+text);
const press=async(sel)=>{await page.waitForSelector(sel,{visible:true});await page.$eval(sel,e=>e.click());};
const fill=async(sel,text)=>{await page.focus(sel);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');if(text)await page.type(sel,text);};
const snapshot=async(name)=>{await page.evaluate(()=>window.scrollTo(0,0));await wait(250);await page.screenshot({path:`${artifacts}/patient-${lang}-${name}.png`,fullPage:true});};
const tab=async(key)=>{await press(`[data-testid="patient-tab-${key}"]`);await wait(250);assert.equal(await page.$eval(`[data-testid="patient-tab-${key}"]`,e=>e.getAttribute('aria-selected')),'true');};
const ok=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.trim()==='حسناً'));await click('حسناً',true);await wait(250);};
const confirmDialog=async()=>{await wait(200);assert(await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length&&b.closest('.fixed'));const b=buttons.at(-1);b?.click();return !!b;}));await wait(350);};
try{
await page.goto(base,{waitUntil:'networkidle2'});await click(en?'Patients Manager':'إدارة المرضى');await page.waitForFunction(n=>document.body.innerText.includes(n),{},pname);
assert(await page.evaluate(n=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes(n));const b=row?.querySelector('button[title="Medical File"],button[title="الملف الطبي"]');b?.click();return !!b;},pname));
await page.waitForSelector('[data-testid="patient-file"]');await page.waitForFunction(e=>document.body.innerText.includes(e?'Select Multiple Teeth':'تحديد أسنان متعددة'),{},en);
assert.equal((await page.$$('[data-testid^="patient-tab-"]')).length,6);
assert((await page.$eval('[data-testid="patient-alerts"]',e=>e.textContent)).includes(en?'Drug allergy':'حساسية أدوية'));
await press('[data-testid="patient-alerts-toggle"]');assert((await page.$eval('[data-testid="patient-alert-details"]',e=>e.textContent)).includes('DB-only clinical detail'));assert((await page.$eval('[data-testid="patient-alert-details"]',e=>e.textContent)).includes('Reception detail retained'));await press('[data-testid="patient-alerts-toggle"]');
await snapshot('chart');console.log('PASS '+lang+' shell, database alerts, six sections, original odontogram visible');
await click(en?'Select Multiple Teeth':'تحديد أسنان متعددة');await wait(200);await tab('notes');await tab('chart');assert((await page.$eval('[data-testid="patient-chart-panel"]',e=>e.textContent)).includes(en?'Cancel Selection':'إلغاء التحديد'));await click(en?'Cancel Selection':'إلغاء التحديد');
await press('[data-testid="patient-add-note"]');await page.waitForSelector('[data-testid="patient-note-draft"]');assert.equal(await page.$eval('[data-testid="patient-note-draft"]',e=>document.activeElement===e),true);
await fill('[data-testid="patient-note-draft"]','Workspace note persisted');await press('[data-testid="save-patient-note"]');await page.waitForFunction(()=>document.querySelector('[data-testid="patient-note-draft"]')?.value==='');
let patient=await db('getDoc',`clinics/${cid}/patients`,'workspace_patient');assert.equal(patient.doctorNotes[0].text,'Workspace note persisted');assert(patient.doctorNotes[0].createdAt);assert(patient.doctorNotes[0].doctorName);
await press(en?'button[title="Edit note"]':'button[title="تعديل الملاحظة"]');await fill('[data-testid="patient-notes-panel"] textarea:not([data-testid])','Edited workspace note');await click(en?'Save Edit':'حفظ التعديل',true);await wait(400);assert.equal((await db('getDoc',`clinics/${cid}/patients`,'workspace_patient')).doctorNotes[0].text,'Edited workspace note');await snapshot('notes');console.log('PASS '+lang+' notes add, author/time metadata, edit, DB persistence');
await tab('visits');assert((await page.$eval('[data-testid="patient-visits-panel"]',e=>e.textContent)).includes('Composite DB Procedure'));assert((await page.$eval('[data-testid="patient-visits-panel"]',e=>e.textContent)).includes('Visit-specific DB note'));await snapshot('visits');
await press(en?'button[title="Delete procedure"]':'button[title="حذف هذا الإجراء"]');await wait(200);await click(en?'Cancel':'إلغاء',true);assert(await db('getDoc',`clinics/${cid}/patients/workspace_patient/records`,'workspace_record'));console.log('PASS '+lang+' visit detail, procedure/tooth/payment/notes, delete cancellation');
await tab('prescriptions');assert((await page.$eval('[data-testid="patient-prescriptions-panel"]',e=>e.textContent)).includes('Database Medication'));await snapshot('prescriptions');await press(en?'button[title="Print prescription"]':'button[title="طباعة الروشتة فورا"]');await page.waitForSelector('iframe[title="print-frame-isolated"]');await page.waitForFunction(()=>document.querySelector('iframe[title="print-frame-isolated"]')?.contentDocument?.body.textContent.includes('Database Medication'));await wait(1800);console.log('PASS '+lang+' prescription archive and print preview');
await tab('xrays');await snapshot('xrays-empty');
const imageData=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=320;const x=c.getContext('2d');x.fillStyle='#172033';x.fillRect(0,0,480,320);x.fillStyle='#f8fafc';x.font='22px sans-serif';x.fillText('ISOLATED X-RAY TEST IMAGE',65,170);return c.toDataURL('image/png').split(',')[1];});const file=artifacts+'/fixture-xray.png';writeFileSync(file,Buffer.from(imageData,'base64'));
await(await page.$('[data-testid="patient-xrays-panel"] input[type="file"]')).uploadFile(file);await page.waitForFunction(e=>document.body.innerText.includes(e?'Ready to Save':'جاهز للحفظ'),{},en);await fill('[data-testid="patient-xrays-panel"] textarea','Uploaded isolated image');await click(en?'Save X-Ray':'حفظ الأشعة',true);await page.waitForFunction(()=>document.body.innerText.includes('Uploaded isolated image'));await ok();
const xrays=await db('getDocs',`clinics/${cid}/patients/workspace_patient/xrays`);assert.equal(xrays.length,1);assert(xrays[0].imageUrl);assert.equal(xrays[0].diagnosis,'Uploaded isolated image');console.log('X-ray persistence '+lang+': '+(xrays[0].isOfflinePending?'offline queue':'server upload'));if(en) assert(!/[٠-٩]/.test(await page.$eval('[data-testid="patient-xrays-panel"]',e=>e.textContent)),'English X-ray times use Latin digits');
await snapshot('xrays');
await press(en?'button[title="Open enlarged X-ray window"]':'button[title="فتح نافذة الأشعة المكبّرة"]');await wait(200);await press(en?'button[title="Close Window"]':'button[title="إغلاق النافذة"]');await click(en?'Zoom & View':'تكبير واستعراض');await page.waitForSelector('img[alt="Enlarged Patient X-Ray"],img[alt="أشعة مريض مكبرة"]');await click(en?'Zoom In':'تكبير',true);await click(en?'Rotate':'تدوير',true);assert(await page.$eval('img[alt="Enlarged Patient X-Ray"],img[alt="أشعة مريض مكبرة"]',e=>e.style.transform.includes('1.3')&&e.style.transform.includes('90deg')));await snapshot('xray-viewer');
await page.evaluate(()=>{const overlay=[...document.querySelectorAll('div.fixed')].find(d=>d.querySelector('img[alt="Enlarged Patient X-Ray"],img[alt="أشعة مريض مكبرة"]'));overlay?.querySelectorAll('button')[0]?.click();});await wait(150);
console.log('PASS '+lang+' X-ray actual file selection, compression, DB save/offline fallback, inline/window viewer, zoom/rotate');
await tab('financials');await page.waitForSelector('[data-testid="patient-balance-summary"]');await page.waitForFunction(()=>document.querySelector('[data-testid="patient-balance-summary"]')?.textContent.includes('500'));await snapshot('financials');await click(en?'Collect Payment / Installment':'تحصيل دفعة أو قسط',true);await page.waitForSelector(en?'input[placeholder="Amount"]':'input[placeholder="المبلغ"]');await fill(en?'input[placeholder="Amount"]':'input[placeholder="المبلغ"]','50');await click(en?'Confirm':'تأكيد',true);await ok();let app=await db('getDoc',`clinics/${cid}/appointments`,'workspace_app');assert.equal(app.paidAmount,350);assert.equal(app.remainingAmount,450);await snapshot('financials-collected');console.log('PASS '+lang+' finance embedded statement, collection and verified receipt/balance DB mutation');

await page.setViewport({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.mouse.move(190,700);await page.mouse.wheel({deltaY:1800});await wait(200);
const scrollState=await page.evaluate(()=>({overflow:document.body.style.overflow,scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight}));
assert.notEqual(scrollState.overflow,'hidden','Embedded Finance must not lock the document');assert(scrollState.height>scrollState.viewport);assert(scrollState.scrollY>0,'Real wheel input must move the embedded Finance page');
await page.screenshot({path:`${artifacts}/finance-scroll-${lang}-mobile.png`,fullPage:false});console.log('PASS '+lang+' embedded Finance mobile wheel scrolling '+JSON.stringify(scrollState));
await page.setViewport({width:1440,height:1050});await page.evaluate(()=>window.scrollTo(0,0));
if (process.env.TEST_WORKSPACE_SMOKE === '1') return;
// Respect the production rate limiter during the dense isolated UI run.
await wait(50000);
// Finance modal compatibility, nested discount, receipt printing and history.
await press(en?'button[title="Apply Session Discount"]':'button[title="تطبيق خصم وتأكيده على هذه الجلسة"]');
await fill(en?'input[placeholder="Enter discount value"]':'input[placeholder="أدخل قيمة الخصم بالجنيه"]','25');
await fill(en?'[placeholder="e.g. Special discount, Guild discount..."]':'[placeholder="مثال: خصم خاص، خصم نقابة، مراعاة حالة..."]','Isolated workspace discount');
await click(en?'Confirm Discount':'تأكيد الخصم',true);await ok();
app=await db('getDoc',`clinics/${cid}/appointments`,'workspace_app');assert.equal(app.price,775);assert.equal(app.remainingAmount,425);
await click(en?'Installments History (':'سجل الدفعات الأقساط (');
await page.evaluate(()=>{window.__printCapture=[];window.__printTimer=setInterval(()=>{const text=document.querySelector('iframe[title="print-frame-isolated"]')?.contentDocument?.body?.textContent;if(text)window.__printCapture.push(text);},20);});
await page.$eval('button[title="'+(en?'Print Receipt':'طباعة الإيصال')+'"]',e=>e.click());
await wait(1800);await page.evaluate(()=>clearInterval(window.__printTimer));assert(await page.evaluate(()=>window.__printCapture.some(t=>t.includes('775'))));
await click(en?'Open separate window':'فتح نافذة مستقلة',true);await wait(300);
assert(await page.$eval('[data-testid="patient-financials-panel"]',e=>e.className.includes('fixed')));assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden','Standalone modal still locks background scrolling');
await press(en?'button[title="Close"]':'button[title="إغلاق"]');
await page.waitForSelector('[data-testid="patient-balance-summary"]');assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','Closing standalone modal restores embedded page scrolling');
console.log('PASS '+lang+' financial window, installment history, discount mutation, printable receipt');
// Edit and download an actual locally selected image; test contrast/reset in the viewer.
await tab('xrays');await press(en?'button[title="Edit X-Ray Image and Diagnosis"]':'button[title="تعديل صورة الأشعة والتشخيص"]');
await fill(en?'textarea[placeholder="Enter radiological diagnosis or findings here..."]':'textarea[placeholder="اكتب التشخيص المكتشف أو ملاحظات الأشعة هنا..."]','Edited radiological finding');await click(en?'Save Changes':'حفظ التعديلات',true);await ok();
assert.equal((await db('getDocs',`clinics/${cid}/patients/workspace_patient/xrays`))[0].diagnosis,'Edited radiological finding');
await click(en?'Zoom & View':'تكبير واستعراض');await click(en?'High Contrast':'تباين عالٍ',true);
assert(await page.$eval('img[alt="Enlarged Patient X-Ray"],img[alt="أشعة مريض مكبرة"]',e=>e.style.filter.includes('contrast(180%)')));
await click(en?'Reset':'إعادة ضبط',true);assert(await page.$eval('img[alt="Enlarged Patient X-Ray"],img[alt="أشعة مريض مكبرة"]',e=>e.style.filter==='none'));
const downloadHref=await page.$eval('a[download]',e=>e.href);assert(downloadHref.startsWith('data:')||downloadHref.startsWith('http'));
const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});await press('a[download]');await wait(400);assert(require('node:fs').readdirSync(artifacts).some(name=>name.startsWith('xray_workspace_patient_')),'Downloaded image exists');
await press(en?'button[aria-label="Close X-ray viewer"]':'button[aria-label="إغلاق عارض الأشعة"]');
await snapshot('xrays');console.log('PASS '+lang+' X-ray diagnosis edit, contrast/reset, download initiated');
// Mobile layout is exercised for every workspace, not only the first tab.
await page.setViewport({width:390,height:844});
for(const key of ['chart','notes','visits','xrays','prescriptions','financials']){
 await tab(key);if(key==='financials')await page.waitForSelector('[data-testid="patient-balance-summary"]');
 await snapshot('mobile-'+key);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile horizontal overflow: '+key);
}
await page.setViewport({width:1440,height:1050});console.log('PASS '+lang+' all six mobile layouts without page overflow');
await wait(20000);
// Destructive actions only touch the isolated fixture, and database reads confirm the effect.
await tab('notes');await press(en?'button[title="Delete note"]':'button[title="حذف الملاحظة"]');await confirmDialog();
assert.equal((await db('getDoc',`clinics/${cid}/patients`,'workspace_patient')).doctorNotes.length,0);
await tab('prescriptions');await press(en?'button[title="Delete prescription"]':'button[title="حذف الروشتة"]');await click(en?'Yes, Delete Permanently':'نعم، احذف نهائياً',true);await wait(300);
assert.equal((await db('getDocs',`clinics/${cid}/prescriptions`)).length,0);
await tab('xrays');await press(en?'button[title="Delete X-Ray"]':'button[title="حذف الأشعة"]');await confirmDialog();await ok();assert.equal((await db('getDocs',`clinics/${cid}/patients/workspace_patient/xrays`)).length,0);
console.log('PASS '+lang+' notes, prescription and X-ray delete with DB verification');
// Patient changes must not carry a draft or another patient\'s record/viewer.
await tab('notes');await fill('[data-testid="patient-note-draft"]','Unsaved first patient draft');await press('[data-testid="patient-switch-toggle"]');await fill('[data-testid="patient-chooser"] input','Other Empty');await click('Other Empty Patient');await page.waitForFunction(()=>document.querySelector('[data-testid="patient-file-header"]')?.textContent.includes('Other Empty Patient'));
await tab('notes');assert.equal(await page.$eval('[data-testid="patient-note-draft"]',e=>e.value),'');assert((await page.$eval('[data-testid="patient-notes-panel"]',e=>e.textContent)).includes(en?'No notes yet':'لا توجد ملاحظات'));
await snapshot('patient-switched');console.log('PASS '+lang+' patient switching, draft isolation and empty-state rendering');

assert.equal(errors.length,0,errors.join('\n'));console.log('PASS all patient workspace sections '+lang);
}catch(e){await snapshot('failure');console.error((await page.evaluate(()=>document.body.innerText)).slice(-8000));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
