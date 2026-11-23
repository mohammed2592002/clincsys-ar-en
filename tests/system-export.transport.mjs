import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
const require=createRequire(import.meta.url),express=require('express');
const root=await mkdtemp(join(tmpdir(),'export-robust-'));
const bundle=resolve('node_modules/.export-robust-'+process.pid+'.cjs');
let server;
try{
 await build({entryPoints:['api/systemBackup.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
 const {installSystemBackup}=require(bundle);
 let mode='normal',released,active=0,peak=0,checks=0;
 const app=express();app.get('/health',(_q,r)=>r.end('ok'));
 installSystemBackup(app,{getReady:async()=>{},getAuth:async req=>req.headers.authorization==='Bearer fixture'?{type:'admin'}:null,isPostgres:()=>false,backups:{streamSystemExport:async(write,{signal})=>{
   active++;peak=Math.max(peak,active);
   try{
    await write('{"ok":true,"padding":"');
    if(mode==='error')throw Error('synthetic patient-secret password-secret');
    if(mode==='hold')await new Promise(r=>released=r);
    if(mode==='abort')for(let i=0;i<10000;i++){if(signal.aborted){checks++;throw Error('cancelled');}await write('x'.repeat(65536));await new Promise(r=>setTimeout(r,1));}
    await write('"}');
   }finally{active--;}
 }}});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer fixture'};
 const ticket=async()=>{const r=await fetch(base+'/api/system-backup/ticket',{method:'POST',headers});assert.equal(r.status,200);return r.json();};
 const status=async t=>(await fetch(base+'/api/system-backup/export-status/'+t.id,{headers})).json();
 assert.equal((await fetch(base+'/api/system-backup/ticket',{method:'POST'})).status,403);
 const t=await ticket();assert(!t.downloadUrl.includes('fixture'));const r=await fetch(base+t.downloadUrl);assert.match(r.headers.get('content-disposition'),/attachment/);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer()))).ok,true);assert.equal((await status(t)).state,'completed');assert.equal((await fetch(base+t.downloadUrl)).status,403);
 const expired=await ticket();const realNow=Date.now;Date.now=()=>realNow()+61000;assert.equal((await fetch(base+expired.downloadUrl)).status,403);Date.now=realNow;
 mode='hold';const held=await ticket(),double=await ticket();const downloading=fetch(base+held.downloadUrl);await new Promise(r=>setTimeout(r,70));assert.equal((await fetch(base+'/api/system-backup/ticket',{method:'POST',headers})).status,409);assert.equal((await fetch(base+'/api/system-backup/export',{headers})).status,409);assert.equal((await fetch(base+double.downloadUrl)).status,409);assert.equal((await status(double)).state,'failed');released();await(await downloading).arrayBuffer();assert.equal(peak,1);
 mode='error';const bad=await ticket();try{await(await fetch(base+bad.downloadUrl)).arrayBuffer();assert.fail('must fail');}catch{}await new Promise(r=>setTimeout(r,30));assert.equal((await status(bad)).state,'failed');assert.equal(await(await fetch(base+'/health')).text(),'ok');
 mode='abort';const cancel=await ticket();const controller=new AbortController();const stream=await fetch(base+cancel.downloadUrl,{signal:controller.signal});const reader=stream.body.getReader();await reader.read();controller.abort();await new Promise(r=>setTimeout(r,100));assert.equal((await status(cancel)).state,'aborted');assert.equal(active,0);assert(checks>0||active===0);
 mode='normal';const after=await ticket();await(await fetch(base+after.downloadUrl)).arrayBuffer();assert.equal((await status(after)).state,'completed');
 assert.equal((await fetch(base+'/api/system-backup/download/invalid')).status,403);assert.equal((await fetch(base+'/api/system-backup/export-status/'+after.id)).status,403);
 console.log('PASS export transport: authorized tickets/status; native attachment; one-use scoped link; gzip valid; concurrent export rejected; producer error survives; abort stops work and releases gate; successful retry.');
}finally{if(server)await new Promise(r=>server.close(r));await rm(bundle,{force:true});await rm(root,{recursive:true,force:true});}
