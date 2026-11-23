import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : '@electric-sql/pglite');
const output=await build({entryPoints:['api/financeStore.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {createFinanceStore}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const pg=new PGlite();
let inject=false;
const db={financeTransaction:async (_cid,fn)=>fn(),getIsPostgres:()=>true,execute:async q=>{
 const sql=typeof q==='string'?q:q.sql; const args=typeof q==='string'?[]:q.args||[];
 if(inject && sql.startsWith('INSERT INTO finance_events')) throw Error('injected event write failure');
 if(!args.length)return pg.query(sql);
 let n=0;return pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args);
}};
async function tx(fn){await pg.exec('BEGIN');try{const result=await fn();await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}}
try {
 const store=createFinanceStore(db);await store.schema();
 const original={version:9,unknown:{n:null,arr:[0,false,'']},receipts:[{id:'same',amountCents:123,opaque:{zero:0}},{id:'same',amountCents:456}],events:[{id:'e',amount:0}],requests:{'odd:key':{signature:'x',result:{pointsChanged:3}},'__proto__':{ignored:true}},assignments:{'receipt:id:with:colon':{shiftId:'s',reason:'سبب'}}};
 Object.defineProperty(original.requests,'__proto__',{value:{voided:true},enumerable:true});
 await db.execute({sql:'INSERT INTO finance_state (id,data) VALUES (?,?)',args:['a',JSON.stringify(original)]});
 await tx(()=>store.migrate('a'));
 assert.deepEqual(await tx(()=>store.load('a')),original);
 await tx(()=>store.migrate('a'));assert.deepEqual(await tx(()=>store.load('a')),original);
 assert.deepEqual(JSON.parse((await pg.query("SELECT data FROM finance_state WHERE id='a'")).rows[0].data),original);
 const changed=structuredClone(original);changed.receipts.reverse();changed.requests.new={recordRef:{table:'appointments',id:'p'}};changed.unknown.extra='kept';
 await tx(()=>store.save('a',changed));assert.deepEqual(await tx(()=>store.load('a')),changed);
 inject=true;const bad=structuredClone(changed);bad.events.push({id:'failure'});
 await assert.rejects(tx(()=>store.save('a',bad)),/injected/);inject=false;
 assert.deepEqual(await tx(()=>store.load('a')),changed);
 await tx(()=>store.buildProjection('a',{receipts:[{id:'r',amountCents:12,patientId:'p',patientPhone:'010',collectionDate:'2026-11-23'}],events:[],expenses:[],appointments:[]},{allTotal:0}));
 assert.equal((await tx(()=>store.selectProjection('a','receipts',{patientId:'p',from:'2026-11-23',to:'2026-11-23'}))).length,1);
 assert.equal((await tx(()=>store.selectProjection('a','receipts',{from:'2026-11-24'}))).length,0);
 assert.equal((await tx(()=>store.selectProjection('b','receipts'))).length,0);
 const ledger=await tx(()=>store.readLedger('a'));ledger.assignments['receipt:id:with:colon']={shiftId:'changed'};assert.equal(ledger.assignments['receipt:id:with:colon'].shiftId,'changed');
 const empty={version:1,receipts:[],events:[],requests:{}};
 assert.deepEqual(await tx(()=>store.load('b')),empty);assert.deepEqual(await tx(()=>store.load('a')),changed);
 await tx(()=>store.remove('a'));assert.equal((await pg.query("SELECT count(*)::int AS n FROM finance_receipts WHERE clinicId='a'")).rows[0].n,0);
 console.log('PASS WASM PostgreSQL: exact payloads/unknown fields/duplicates/order/prototype-like map keys; idempotency; source archive; transactional rollback; tenant isolation; cleanup.');
}finally{await pg.close();}
