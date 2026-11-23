import {build} from 'esbuild';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {rm} from 'node:fs/promises';import {createGzip} from 'node:zlib';import {Writable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {once} from 'node:events';import assert from 'node:assert/strict';
const file=resolve('node_modules/.export-scale-'+process.pid+'.cjs'),require=createRequire(import.meta.url);
try{
 await build({entryPoints:['api/backup.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',packages:'external'});const {createBackupService}=require(file);
 const n=250000,padding='synthetic'.repeat(64);let maxBatch=0,patients=0;
 const db={financeTransaction:async(_c,fn)=>fn(),execute:async({sql,args=[]})=>{
  if(sql==='SELECT * FROM clinics')return {rows:[{id:'syn_scale',data:JSON.stringify({id:'syn_scale',name:'synthetic scale'})}]};
  if(sql==='SELECT * FROM clinics WHERE id = ?')return {rows:[{id:'syn_scale',data:'{"id":"syn_scale","name":"synthetic scale"}'}]};
  if(sql.startsWith('SELECT * FROM patients')){assert(sql.includes('LIMIT 100'));const last=args.length>1?Number(args[1].slice(4))+1:0;const rows=Array.from({length:Math.max(0,Math.min(100,n-last))},(_,i)=>{const id='syn_'+String(last+i).padStart(9,'0');return {id,data:JSON.stringify({id,clinicId:'syn_scale',name:'synthetic',padding})};});maxBatch=Math.max(maxBatch,rows.length);patients+=rows.length;return {rows};}
  return {rows:[]};
 }};
 const service=createBackupService({db,finance:{streamExport:async(_c,w)=>w('{"version":1,"receipts":[],"events":[],"requests":{}}')},hashPassword:async p=>p});
 const gzip=createGzip({level:1});let bytes=0,raw=0,peak=process.memoryUsage().rss;const start=Date.now(),baseline=peak;
 const transfer=pipeline(gzip,new Writable({write(c,_e,cb){bytes+=c.length;peak=Math.max(peak,process.memoryUsage().rss);cb();}}));transfer.catch(()=>{});
 await service.streamSystemExport(async s=>{raw+=Buffer.byteLength(s);if(!gzip.write(s))await once(gzip,'drain');});gzip.end();await transfer;assert.equal(patients,n);assert.equal(maxBatch,100);
 console.log(JSON.stringify({measured:true,fixture:'single synthetic clinic, generated row batches, not live DB',patientRows:patients,maxRowsPerBatch:maxBatch,uncompressedMiB:+(raw/1048576).toFixed(2),gzipMiB:+(bytes/1048576).toFixed(2),seconds:+((Date.now()-start)/1000).toFixed(2),baselineRssMiB:+(baseline/1048576).toFixed(1),peakObservedRssMiB:+(peak/1048576).toFixed(1)}));
}finally{await rm(file,{force:true});}
