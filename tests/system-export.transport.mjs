import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url),express=require('express');
const root=await mkdtemp(join(tmpdir(),'export-robust-'));
const bundle=resolve('node_modules/.export-robust-'+process.pid+'.cjs');
const leftovers=()=>readdirSync(tmpdir()).filter(d=>d.startsWith('system-export-artifact-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let server;
try{
 await build({entryPoints:['api/systemBackup.ts'],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external'});
 const {installSystemBackup}=require(bundle);
 // Incompressible payload (~1.5 MB of gzip) so byte ranges are meaningful.
 const payload=randomBytes(1_000_000).toString('hex');
 let mode='normal',released,active=0,peak=0;
 const app=express();app.get('/health',(_q,r)=>r.end('ok'));
 installSystemBackup(app,{getReady:async()=>{},getAuth:async req=>req.headers.authorization==='Bearer fixture'?{type:'admin'}:null,isPostgres:()=>false,backups:{streamSystemExport:async(write,{signal})=>{
   active++;peak=Math.max(peak,active);
   try{
    await write('{"ok":true,"padding":"');
    if(mode==='error'){await write('x'.repeat(100000));throw Error('synthetic patient-secret password-secret');}
    if(mode==='hold')await new Promise(r=>released=r);
    for(let i=0;i<payload.length;i+=65536){if(signal.aborted)throw Error('cancelled');await write(payload.slice(i,i+65536));}
    await write('"}');
   }finally{active--;}
 }}});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer fixture'};
 const ticket=async()=>{const r=await fetch(base+'/api/system-backup/ticket',{method:'POST',headers});assert.equal(r.status,200);return r.json();};
 const status=async t=>(await fetch(base+'/api/system-backup/export-status/'+t.id,{headers})).json();
 const waitState=async(t,states)=>{for(let i=0;i<400;i++){const s=await status(t);if(states.includes(s.state))return s;await sleep(25);}assert.fail('timeout waiting '+states);};
 assert.equal((await fetch(base+'/api/system-backup/ticket',{method:'POST'})).status,403);
 assert.equal((await fetch(base+'/api/system-backup/export-status/x')).status,403);

 // 1. Generate once, then serve a complete file with Content-Length and Range support.
 const t=await ticket();assert(!t.downloadUrl.includes('fixture'));
 const ready=await waitState(t,['ready']);assert(ready.size>1_000_000);
 const url=base+t.downloadUrl;
 const full=await fetch(url);
 assert.equal(full.status,200);assert.match(full.headers.get('content-disposition'),/attachment/);assert.match(full.headers.get('cache-control'),/no-store/);
 assert.equal(full.headers.get('accept-ranges'),'bytes');assert.equal(full.headers.get('content-type'),'application/gzip');assert(!full.headers.get('content-encoding'));
 const etag=full.headers.get('etag');assert(etag&&!etag.startsWith('W/'),'strong ETag so Chrome can resume');
 const fullBytes=Buffer.from(await full.arrayBuffer());
 assert.equal(Number(full.headers.get('content-length')),ready.size);assert.equal(fullBytes.length,ready.size);
 assert.equal(JSON.parse(gunzipSync(fullBytes)).ok,true);
 await sleep(50);const done=await status(t);assert.equal(done.state,'completed');assert.equal(done.delivered,true);
 assert(done.expiresAt-Date.now()<=5*60*1000+1000,'finished download shortens remaining life');

 // 2. Retry with the same link works (the old single-use 403 is gone).
 const again=await fetch(url);assert.equal(again.status,200);assert(Buffer.from(await again.arrayBuffer()).equals(fullBytes));

 // 3. Range resume: connection drops after N bytes, client resumes with Range + If-Range.
 const cut=Math.floor(ready.size/3);
 const head=await fetch(url,{headers:{range:'bytes=0-'+(cut-1)}});assert.equal(head.status,206);assert.equal(head.headers.get('content-range'),`bytes 0-${cut-1}/${ready.size}`);assert.equal(Number(head.headers.get('content-length')),cut);
 const part1=Buffer.from(await head.arrayBuffer());
 const rest=await fetch(url,{headers:{range:'bytes='+cut+'-','if-range':etag}});assert.equal(rest.status,206);assert.equal(rest.headers.get('content-range'),`bytes ${cut}-${ready.size-1}/${ready.size}`);assert.equal(Number(rest.headers.get('content-length')),ready.size-cut);
 const part2=Buffer.from(await rest.arrayBuffer());
 assert(Buffer.concat([part1,part2]).equals(fullBytes),'resumed bytes are identical to a single download');
 assert.equal(JSON.parse(gunzipSync(Buffer.concat([part1,part2]))).ok,true);
 const suffix=await fetch(url,{headers:{range:'bytes=-100'}});assert.equal(suffix.status,206);assert(Buffer.from(await suffix.arrayBuffer()).equals(fullBytes.subarray(ready.size-100)));
 const bad=await fetch(url,{headers:{range:'bytes='+(ready.size+10)+'-'}});assert.equal(bad.status,416);assert.equal(bad.headers.get('content-range'),'bytes */'+ready.size);await bad.arrayBuffer();
 const stale=await fetch(url,{headers:{range:'bytes='+cut+'-','if-range':'"other-export"'}});assert.equal(stale.status,200);assert.equal((await stale.arrayBuffer()).byteLength,ready.size);
 const headReq=await fetch(url,{method:'HEAD'});assert.equal(headReq.status,200);assert.equal(Number(headReq.headers.get('content-length')),ready.size);
 assert.equal((await fetch(base+'/api/system-backup/download/invalid')).status,403);

 // 4. A truncated live download (client aborts mid-stream) can be resumed from the file.
 const ctl=new AbortController();const live=await fetch(url,{signal:ctl.signal});const reader=live.body.getReader();let got=0;const chunks=[];while(got<200000){const {value}=await reader.read();chunks.push(Buffer.from(value));got+=value.length;}ctl.abort();
 const gotBuf=Buffer.concat(chunks);assert(gotBuf.equals(fullBytes.subarray(0,gotBuf.length)));
 const resumed=await fetch(url,{headers:{range:'bytes='+gotBuf.length+'-',"if-range":etag}});assert.equal(resumed.status,206);
 assert(Buffer.concat([gotBuf,Buffer.from(await resumed.arrayBuffer())]).equals(fullBytes));

 // 5. One export at a time; download before ready is refused; legacy route is gated too.
 mode='hold';const held=await ticket();await sleep(80);
 assert.equal((await status(held)).state,'generating');
 assert.equal((await fetch(base+'/api/system-backup/ticket',{method:'POST',headers})).status,409);
 assert.equal((await fetch(base+'/api/system-backup/export',{headers})).status,409);
 assert.equal((await fetch(base+held.downloadUrl)).status,409);
 released();const heldReady=await waitState(held,['ready']);assert.equal(peak,1);
 assert.equal((await status(t)).state,'expired','new export replaced the previous temporary file');
 assert.equal((await fetch(url)).status,403);assert.equal(leftovers().length,1);

 // 6. Generation error: partial file deleted at once, no secrets in status, server alive, retry works.
 mode='error';const failed=await ticket();const f=await waitState(failed,['failed']);
 assert(!JSON.stringify(f).includes('secret'));assert.equal(leftovers().length,0);
 assert.equal(await(await fetch(base+'/health')).text(),'ok');
 assert.equal((await fetch(base+failed.downloadUrl)).status,403);

 // 7. TTL: unused file expires and is deleted.
 mode='normal';const ttl=await ticket();await waitState(ttl,['ready']);assert.equal(leftovers().length,1);
 const realNow=Date.now;Date.now=()=>realNow()+31*60*1000;
 assert.equal((await fetch(base+ttl.downloadUrl)).status,403);Date.now=realNow;
 assert.equal(leftovers().length,0);assert.equal((await status(ttl)).state,'expired');

 // 8. Legacy live-stream route still works; a fresh export after everything succeeds.
 const legacy=await fetch(base+'/api/system-backup/export',{headers});assert.equal(JSON.parse(gunzipSync(Buffer.from(await legacy.arrayBuffer()))).ok,true);
 const after=await ticket();await waitState(after,['ready']);assert.equal(JSON.parse(gunzipSync(Buffer.from(await(await fetch(base+after.downloadUrl)).arrayBuffer()))).ok,true);
 console.log('PASS export transport: generate-once temp file; Content-Length; strong ETag; Range 206/416/If-Range resume identical bytes; reusable link; one export at a time; error and TTL cleanup; legacy route; auth.');
}finally{if(server)await new Promise(r=>{server.closeAllConnections?.();server.close(r);});await rm(bundle,{force:true});await rm(root,{recursive:true,force:true});}
