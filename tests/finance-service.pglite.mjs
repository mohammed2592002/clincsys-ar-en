import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : '@electric-sql/pglite');
const output=await build({entryPoints:['api/finance.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {createFinanceService}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const pg=new PGlite();let depth=0;
const db={getIsPostgres:()=>true,execute:async q=>{let i=0;return pg.query((typeof q==='string'?q:q.sql).replace(/\?/g,()=>'$'+(++i)),typeof q==='string'?[]:q.args||[]);},financeTransaction:async(_cid,fn)=>{if(depth)return fn();await pg.exec('BEGIN');depth++;try{const result=await fn();await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}finally{depth--;}}};
const cid='pg_finance',auth={type:'manager',clinicId:cid};
const service=createFinanceService({db,getAuth:async()=>auth,broadcast:()=>{},mapColumns:(_table,id,data,clinicId)=>({cols:['id','clinicId','data'],vals:[id,clinicId,JSON.stringify(data)]})});
const write=async(table,id,data)=>db.execute({sql:`INSERT INTO ${table} (id,clinicId,data) VALUES (?,?,?)`,args:[id,cid,JSON.stringify({id,clinicId:cid,...data})]});
let counter=0;const run=body=>service.run(cid,auth,{requestId:'req'+(++counter),...body});
async function view(body){let status=200,result;await service.handler({body:{clinicId:cid,action:'view',...body},headers:{}},{status(s){status=s;return this;},json(r){result=r;return this;}});assert.equal(status,200,JSON.stringify(result));return result;}
try{
for(const table of ['clinics','patients','appointments','expenses','shifts','lab_orders','records','prescriptions','xrays','teeth','billing','closings'])await pg.exec(`CREATE TABLE ${table} (id text primary key, clinicId text, data text)`);
await write('clinics',cid,{name:'PG fixture',paymentMethods:['كاش'],isActive:true});await write('patients','p',{name:'Patient'});
await service.ensureSchema();
const shift=await run({action:'open',date:'2026-11-23',startCash:0});
await run({action:'write',table:'appointments',id:'a',data:{patientId:'p',patientName:'Patient',patientPhone:'010',price:100,paidAmount:0,status:'completed',date:'2026-11-23'}});
const body={action:'collect',requestId:'stable',appointmentId:'a',amount:25,paymentMethod:'كاش'};
const collection=await run(body);assert(collection.receipt);
const repeat=await run(body);assert.equal(repeat.receipt.id,collection.receipt.id);
let patient=await view({scope:'patient',patientId:'p'});assert.equal(patient.receipts.length,1);assert.equal(patient.appointments.length,1);
const phone=await view({scope:'patient',patientId:'unknown',patientPhone:'010'});assert.equal(phone.receipts.length,1);
assert.equal((await view({scope:'patient',patientName:'Patient'})).receipts.length,1);
assert.equal((await view({scope:'revenues',from:'2000-01-01',to:'2000-01-01'})).receipts.length,0);
assert.equal((await view({scope:'shift',shiftId:shift.id,date:shift.date})).receipts.length,1);
await run({action:'refund',appointmentId:'a',receiptId:collection.receipt.id,amount:5,paymentMethod:'كاش',reason:'refund test'});
patient=await view({scope:'patient',patientId:'p'});assert.equal(patient.receipts.length,2);
assert.equal(patient.receipts.reduce((n,r)=>n+(r.kind==='refund'?-1:1)*r.amountCents,0),2000);
const exported=await db.financeTransaction(cid,()=>service.exportState(cid));assert(exported.requests.stable);assert.equal(exported.receipts.length,2);
console.log('PASS actual finance service over WASM PostgreSQL: collection retry dedup, refund, projection invalidation, patient ID/phone/name fallback, shift and date-scoped indexed reads, exact exported requests.');
}finally{await pg.close();}
