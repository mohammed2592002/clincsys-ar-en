import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import puppeteer from 'puppeteer-core';

const dir=await mkdtemp(join(tmpdir(),'coredent-panel-'));
const clinic={id:'panel_test',name:'Panel Test Clinic',email:'panel@example.invalid',password:'local-test-password',staffPin:'4826',isActive:true,subscriptionExpiresAt:'2030-01-01',staffMembers:[]};
await writeFile(join(dir,'local_db.json'),JSON.stringify({clinics:[{id:clinic.id,data:JSON.stringify(clinic)}]}));
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base=`http://127.0.0.1:${port}`;
const env={...process.env,NODE_ENV:'production', ALLOW_LOCAL_JSON_DB: '1', PORT:String(port),AUTH_SECRET:'isolated-panel-test-secret'};
for(const k of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME'])delete env[k];
const server=spawn(process.execPath,[resolve('dist-server/server.cjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function clickByText(page,text,tag='button'){
  const found=await page.evaluate((t,tg)=>{
    const b=[...document.querySelectorAll(tg)].find(b=>b.getClientRects().length&&b.textContent.includes(t));
    if(b){b.click();return true;}
    return false;
  },text,tag);
  assert(found,'missing clickable: '+text);
  await sleep(700);
}

try{
  for(let i=0;i<100;i++){try{await fetch(base);break;}catch{}await sleep(100);}
  const login=await fetch(base+'/api/auth/clinic-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:clinic.email,password:clinic.password,role:'manager'})}).then(r=>r.json());
  assert(login.success&&login.token,'manager login');
  const pat=await fetch(base+'/api/db',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify({action:'setDoc',path:`clinics/${clinic.id}/patients`,id:'p_sel',data:{name:'مريض اختبار التحديد',loyaltyPoints:0}})});
  assert.equal(pat.status,200,'seed patient');

  browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors=[];
  await mkdir('/downloads/panel-proof',{recursive:true});

  async function openChart(lang){
    const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});
    await page.evaluateOnNewDocument((token,c,l)=>{
      localStorage.setItem('dental_auth_token',token);
      localStorage.setItem('dental_saas_session',JSON.stringify({type:'clinic',clinicId:c.id,clinicName:c.name}));
      localStorage.setItem('i18nextLng',l);
      localStorage.setItem('auto_backup_last_date_'+c.id,'2026-11-21');
    },login.token,login.clinic,lang);
    await page.goto(base,{waitUntil:'networkidle2'});
    await sleep(2000);
    // Force the requested UI language via the header switcher (init language races otherwise)
    if(lang==='ar'&&await page.evaluate(()=>document.body.innerText.includes('Patients Manager'))){
      await clickByText(page,'العربية');
      await page.waitForFunction(()=>document.body.innerText.includes('إدارة المرضى'),{timeout:15000});
    }
    if(lang==='en'&&await page.evaluate(()=>document.body.innerText.includes('إدارة المرضى'))){
      await clickByText(page,'English');
      await page.waitForFunction(()=>document.body.innerText.includes('Patients Manager'),{timeout:15000});
    }
    await page.waitForFunction(()=>document.body.innerText.includes('مريض اختبار التحديد'),{timeout:20000});
    await sleep(1500);
    const mfLabel=lang==='ar'?'الملف الطبي':'Medical File';
    const hasMf=await page.evaluate(l=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&(b.title===l||b.textContent.includes(l))),mfLabel);
    if(!hasMf){
      const dump=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>(b.textContent||'').trim().slice(0,25)).slice(0,40));
      console.log('DEBUG visible buttons:',JSON.stringify(dump));
      throw new Error('medical file button never rendered');
    }
    const chartMarker=lang==='ar'?'تحديد أسنان متعددة':'Select Multiple Teeth';
    for(let attempt=0;attempt<4;attempt++){
      await page.evaluate(l=>{
        const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&(b.title===l||b.textContent.includes(l)));
        if(b)b.click();
      },mfLabel);
      try{
        await page.waitForFunction(m=>document.body.innerText.includes(m),{timeout:10000},chartMarker);
        break;
      }catch(e){ if(attempt===3)throw e; }
    }
    return page;
  }

  async function panelHandle(page){
    const info=await page.evaluate(()=>{
      const cands=[...document.querySelectorAll('div')].filter(d=>typeof d.className==='string'&&d.className.includes('rounded-[24px]'));
      return cands.map(d=>({cls:d.className.slice(0,80),txt:(d.textContent||'').slice(0,40)}));
    });
    console.log('panel candidates:',JSON.stringify(info));
    const h=await page.evaluateHandle(()=>{
      return [...document.querySelectorAll('div')].find(d=>typeof d.className==='string'&&d.className.includes('rounded-[24px]')&&(d.textContent.includes('تحديد سريع')||d.textContent.includes('Quick select')));
    });
    const el=h.asElement();
    assert(el,'panel element found');
    return el;
  }

  // ---- Arabic flow ----
  const page=await openChart('ar');
  await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});

  // Enable multi-select mode
  await clickByText(page,'تحديد أسنان متعددة');
  await page.waitForFunction(()=>document.body.innerText.includes('وضع تحديد الأسنان المتعددة'));
  await page.waitForFunction(()=>document.body.innerText.includes('لم يتم تحديد أسنان بعد'));
  await sleep(400);
  let panel=await panelHandle(page);
  await panel.screenshot({path:'/downloads/panel-proof/ar-desktop-idle.png'});

  // One-line instruction: long paragraph gone
  assert(!(await page.evaluate(()=>document.body.innerText)).includes('تعليمات التحديد:'),'old long instructions removed');

  // Apply with zero selection keeps the old warning behavior
  await clickByText(page,'اختيار وتطبيق الإجراء');
  await page.waitForFunction(()=>document.body.innerText.includes('يرجى النقر على سن واحد'));
  await clickByText(page,'حسناً');

  // Quick-select chip drives selection; count strip appears above apply
  await clickByText(page,'الأضراس');
  await page.waitForFunction(()=>/[0-9]+ أسنان محددة/.test(document.body.innerText));
  const countText=await page.evaluate(()=>[...document.querySelectorAll('div')].find(d=>d.className.includes('rounded-[14px]')&&/أسنان محددة/.test(d.textContent)&&d.textContent.length<120)?.textContent||'');
  const selectedCount=parseInt(countText.match(/([0-9]+) أسنان محددة/)[1],10);
  assert(selectedCount>0,'posteriors selected');
  assert(countText.includes('('),'tooth numbers listed in strip');
  await page.waitForFunction(()=>document.body.innerText.includes('مسح الكل'));
  await sleep(300);
  panel=await panelHandle(page);
  await panel.screenshot({path:'/downloads/panel-proof/ar-desktop-selected.png'});

  // مسح الكل resets to idle strip
  await clickByText(page,'مسح الكل');
  await page.waitForFunction(()=>document.body.innerText.includes('لم يتم تحديد أسنان بعد'));

  // Switch in panel header cancels the mode (old X behavior)
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button[role=switch]')].find(b=>b.getClientRects().length);b.click();});
  await sleep(500);
  await page.waitForFunction(()=>!document.body.innerText.includes('وضع تحديد الأسنان المتعددة'));

  // Re-enable, select, cancel via the ghost button
  await clickByText(page,'تحديد أسنان متعددة');
  await page.waitForFunction(()=>document.body.innerText.includes('وضع تحديد الأسنان المتعددة'));
  await clickByText(page,'الفك العلوي');
  await page.waitForFunction(()=>/[0-9]+ أسنان محددة/.test(document.body.innerText));
  await clickByText(page,'إلغاء التحديد');
  await page.waitForFunction(()=>!document.body.innerText.includes('وضع تحديد الأسنان المتعددة'));

  // Mobile AR: idle + selected, no horizontal overflow
  await page.setViewport({width:390,height:844,deviceScaleFactor:2});
  await clickByText(page,'تحديد أسنان متعددة');
  await page.waitForFunction(()=>document.body.innerText.includes('لم يتم تحديد أسنان بعد'));
  await sleep(400);
  panel=await panelHandle(page);
  await panel.screenshot({path:'/downloads/panel-proof/ar-mobile-idle.png'});
  await clickByText(page,'الأضراس');
  await page.waitForFunction(()=>/[0-9]+ أسنان محددة/.test(document.body.innerText));
  await sleep(300);
  panel=await panelHandle(page);
  await panel.screenshot({path:'/downloads/panel-proof/ar-mobile-selected.png'});
  const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(dims.scroll<=dims.width+1,'no horizontal overflow: '+JSON.stringify(dims));
  // Full-page context shot (panel above the chart)
  await page.screenshot({path:'/downloads/panel-proof/ar-mobile-context.png',fullPage:false});
  await page.close();

  // ---- English flow ----
  const en=await openChart('en');
  await en.setViewport({width:1440,height:1000,deviceScaleFactor:1});
  await clickByText(en,'Select Multiple Teeth');
  await en.waitForFunction(()=>document.body.innerText.includes('Multi-Tooth Selection'));
  await en.waitForFunction(()=>document.body.innerText.includes('No teeth selected yet'));
  await clickByText(en,'Posteriors');
  await en.waitForFunction(()=>/[0-9]+ teeth selected/.test(document.body.innerText));
  await sleep(300);
  panel=await panelHandle(en);
  await panel.screenshot({path:'/downloads/panel-proof/en-desktop-selected.png'});
  await en.setViewport({width:390,height:844,deviceScaleFactor:2});
  await sleep(400);
  panel=await panelHandle(en);
  await panel.screenshot({path:'/downloads/panel-proof/en-mobile-selected.png'});
  const dimsEn=await en.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(dimsEn.scroll<=dimsEn.width+1,'EN no horizontal overflow: '+JSON.stringify(dimsEn));
  await en.close();

  assert.deepEqual(errors,[],'no browser JS errors: '+errors.join(' | '));
  console.log('PASS panel redesign: AR/EN, desktop/mobile, idle/selected, warning behavior, clear-all, switch-off, cancel, no overflow, no JS errors. Posteriors selected:',selectedCount);
}finally{
  if(browser)await browser.close();
  server.kill();await new Promise(r=>server.on('exit',r));
  await rm(dir,{recursive:true,force:true});
}
