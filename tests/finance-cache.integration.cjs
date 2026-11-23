const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
(async()=>{
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try{
const page=await browser.newPage();await page.goto(process.env.TEST_BASE+'/robots.txt');
await page.addScriptTag({path:process.env.OFFLINE_TEST_BUNDLE});
const result=await page.evaluate(async()=>{
const api=OfflineAudit;let calls=0,release;
const owner='test-cache-owner';api.setAuthToken(owner);
window.fetch=async()=>{const n=++calls;if(n===1)await new Promise(r=>release=r);return new Response(JSON.stringify({receipts:[{id:'r'+n,amount:10}],appointments:[],expenses:[],events:[]}),{status:200});};
const body={action:'view',scope:'shift',shiftId:'s',date:'2026-11-23'};
const first=api.financeCommand('a',body);
await new Promise(r=>setTimeout(r,5));
api.clearTableCache('appointments');
const fresh=await api.financeCommand('a',body);release();await first;
const cached=await api.financeCommand('a',body);cached.receipts[0].amount=999;
const intact=await api.financeCommand('a',body);
const afterWarm=calls;
await api.financeCommand('b',body);const afterClinic=calls;
api.setAuthToken('different-cache-owner');await api.financeCommand('a',body);const afterOwner=calls;
api.clearQueryCache();await api.financeCommand('a',body);const afterClear=calls;
return {fresh:fresh.receipts[0].id,cached:cached.receipts[0].id,intact:intact.receipts[0].amount,afterWarm,afterClinic,afterOwner,afterClear};
});
assert.deepEqual(result,{fresh:'r2',cached:'r2',intact:10,afterWarm:2,afterClinic:3,afterOwner:4,afterClear:5});
console.log('PASS finance view cache: late stale response cannot poison cache; values isolated from caller edits; clinic/account separation; explicit invalidation.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
