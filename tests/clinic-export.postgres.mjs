import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url),file=resolve('node_modules/.clinic-export-pg-'+process.pid+'.cjs');
const db=new PGlite();let sqls=[];
const gc=global.gc||(()=>{});
try{
 await build({stdin:{contents:"export {createBackupService} from './api/backup';export {createFinanceStore} from './api/financeStore';",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});
 const {createBackupService,createFinanceStore}=require(file);
 const driver={getIsPostgres:()=>true,financeTransaction:async(_cid,fn)=>fn(),execute:async q=>{const sql=typeof q==='string'?q:q.sql,args=typeof q==='string'?[]:q.args||[];sqls.push(sql);let i=0;return db.query(sql.replace(/\?/g,()=>'$'+(++i)),args);}};
 const store=createFinanceStore(driver);await store.schema();
 const tables=['clinics','patients','appointments','records','teeth','xrays','prescriptions','custom_medications','custom_categories','shifts','expenses','inventory','billing','closings','laboratories','lab_orders','lab_work_types','superadmin_credentials','renewals','announcements','system_settings'];
 for(const table of tables)await db.exec(`CREATE TABLE ${table}(id text primary key,clinicId text,data text)`);
 for(const table of ['records','teeth','xrays'])await db.exec(`ALTER TABLE ${table} ADD COLUMN patientId text`);
 const cid='syn_pg';
 const insert=async(table,id,d,clinic=cid)=>['records','teeth','xrays'].includes(table)?db.query(`INSERT INTO ${table} (id,clinicId,patientId,data) VALUES($1,$2,$3,$4)`,[id,clinic,d.patientId,JSON.stringify(d)]):db.query(`INSERT INTO ${table} (id,clinicId,data) VALUES($1,$2,$3)`,[id,clinic,JSON.stringify(d)]);
 await insert('clinics',cid,{id:cid,name:'PG fixture'});
 await insert('clinics','syn_small',{id:'syn_small',name:'Small fixture'},'syn_small');
 // 8250 patients across nine keyset pages; appointments, nested records/teeth/xrays for each.
 for(let i=0;i<8250;i++){
  const id='syn_'+String(i).padStart(5,'0'),patient={id,clinicId:cid,name:'Patient '+i,phone:'0100'+String(i).padStart(7,'0')};
  await insert('patients',id,patient);
  await insert('appointments',id+'_a',{id:id+'_a',clinicId:cid,patientId:id,date:'2026-11-23'});
  await insert('records',id+'_r',{id:id+'_r',clinicId:cid,patientId:id,note:'تشخيص '+i});
  if(i%3===0)await insert('teeth',id+'_t',{id:id+'_t',clinicId:cid,patientId:id,tooth:11});
  if(i%5===0)await insert('xrays',id+'_x',{id:id+'_x',clinicId:cid,patientId:id,url:'https://example.invalid/x'});
 }
 for(const table of ['prescriptions','custom_medications','custom_categories','shifts','expenses','inventory','billing','closings','laboratories','lab_orders','lab_work_types'])
  for(let i=0;i<7;i++)await insert(table,table+'_'+i,{id:table+'_'+i,clinicId:cid,n:i});
 for(let i=0;i<3;i++)await insert('patients','small_'+i,{id:'small_'+i,clinicId:'syn_small',name:'Small '+i},'syn_small');
 const receipts=Array.from({length:1251},(_,i)=>({id:'syn_r'+i,amountCents:i,method:'cash'}));
 const state={version:1,receipts,events:[{id:'syn_e',type:'fixture'}],requests:{'test.map.key':{response:{ok:true}}},assignments:{'expense:one':'shift-one'}};
 await store.save(cid,state);
 const finance={ensureSchema:store.schema,exportState:store.load,streamExport:store.streamExport};
 const service=createBackupService({db:driver,getAuth:async()=>({type:'admin'}),finance,hashPassword:async p=>p,defaultAdmin:null});
 const streamed=async c=>{let out='';await service.streamClinicExport(c,async chunk=>{out+=chunk;},()=>{});return out;};
 // Byte-identical shape: streamed export must deep-equal the legacy materialized export.
 sqls=[];const legacy=await service.exportClinic(cid);const legacySqls=sqls.splice(0);
 const text=await streamed(cid);const parsed=JSON.parse(text);
 parsed.exportTimestamp=legacy.exportTimestamp=null;
 assert.deepEqual(parsed,legacy);
 assert.equal(parsed.data.patients.length,8250);
 assert.equal(parsed.data.patients[0].records.length,1);
 assert.equal(parsed.data.patients[0].teeth.length,1);
 assert.equal(parsed.data.patients[1].xrays.length,0);
 assert.equal(parsed.data.records.length,8250);
 assert.deepEqual(parsed.data.finance_state,legacy.data.finance_state);
 // Every clinic table read is keyset-batched; no whole-clinic SELECT and no OFFSET.
 const names=['patients','appointments','records','teeth','xrays','prescriptions','custom_medications','custom_categories','shifts','expenses','inventory','billing','closings','laboratories','lab_orders','lab_work_types'];
 const reads=sqls.filter(s=>names.some(t=>s.startsWith('SELECT * FROM '+t+' ')));
 assert(reads.length>9,'expected multiple batches, got '+reads.length);
 assert(reads.every(s=>s.includes('LIMIT 1000')),'unbatched read: '+reads.find(s=>!s.includes('LIMIT 1000')));
 assert(!reads.some(s=>s.includes('OFFSET')));
 assert.equal(reads.filter(s=>s.startsWith('SELECT * FROM patients')).length,9);
 assert(reads.filter(s=>s.includes('patientId IN')).length>=9);
 // Small clinic: no patient batch, nested IN queries skipped, still identical.
 const smallLegacy=await service.exportClinic('syn_small');const smallParsed=JSON.parse(await streamed('syn_small'));
 smallParsed.exportTimestamp=smallLegacy.exportTimestamp=null;
 assert.deepEqual(smallParsed,smallLegacy);
 assert.equal(smallParsed.data.patients.length,3);
 // Memory: legacy retains the whole clinic object; streaming retains nothing.
 gc();const baseLegacy=process.memoryUsage().heapUsed;
 const held=await service.exportClinic(cid);gc();const legacyRetained=process.memoryUsage().heapUsed-baseLegacy;
 assert.equal(held.data.patients.length,8250);
 gc();const baseStream=process.memoryUsage().heapUsed;
 let bytes=0;await service.streamClinicExport(cid,async chunk=>{bytes+=Buffer.byteLength(chunk);},()=>{});gc();const streamRetained=process.memoryUsage().heapUsed-baseStream;
 const mb=n=>Math.round(n/104857.6)/10;
 console.log(`clinic export ${mb(bytes)} bytes: legacy retains ${mb(legacyRetained)} MB heap, streamed retains ${mb(streamRetained)} MB`);
 assert(legacyRetained>bytes/4,'legacy export should retain a large fraction of the payload, got '+mb(legacyRetained)+' MB');
 assert(streamRetained<legacyRetained/10,'streamed export should retain <10% of legacy, got '+mb(streamRetained)+' MB');
 console.log('PASS PostgreSQL clinic export: streamed export is byte-equivalent to the legacy export across nine keyset patient pages with nested records/teeth/xrays, finance_state identical, every table read batched (LIMIT 1000, keyset, no OFFSET), small-clinic path identical, retained heap bounded.');
}finally{await db.close();await rm(file,{force:true});}
