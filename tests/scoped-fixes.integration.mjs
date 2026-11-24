import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
const dir=await mkdtemp(join(tmpdir(),'clinic-scoped-fixes-'));
const secret='local-scoped-fixes-signing-secret';
const a='synthetic_delete_a',b='synthetic_keep_b';
const row=(id,cid,data={})=>({id,clinicId:cid,data:JSON.stringify({id,clinicId:cid,...data})});
const tables=['users','patients','appointments','records','prescriptions','custom_medications','custom_categories','inventory','billing','closings','laboratories','lab_orders','lab_work_types','shifts','expenses','teeth','xrays','renewals'];
const seed={clinics:[row(a,a,{name:'Synthetic A',isActive:true,staffMembers:[]}),row(b,b,{name:'Synthetic B',isActive:true,staffMembers:[]})],finance_state:[row(a,a,{version:1,receipts:[],events:[],requests:{}}),row(b,b,{version:1,receipts:[],events:[],requests:{}})],files:[{path:'a.png',clinicId:a,data:''},{path:'b.png',clinicId:b,data:''}],server_sync_events:[{id:'ea',clinic_id:a,created_at:Date.now()},{id:'eb',clinic_id:b,created_at:Date.now()}]};
for(const t of tables)seed[t]=[row(t+'-a',a,{name:'Synthetic fixture',createdAt:'2026-11-23'}),row(t+'-b',b,{name:'Other clinic'})];
seed.patients.push(...Array.from({length:220},(_,i)=>row('patient-'+i,a,{name:'Search fixture '+i,phone:'010'+String(i).padStart(8,'0'),createdAt:'2026-11-23T00:00:00Z'})));
await writeFile(join(dir,'local_db.json'),JSON.stringify(seed));
const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const env={...process.env,NODE_ENV:'production',PORT:String(port),AUTH_SECRET:secret};
for(const k of Object.keys(env))if(/^(DATABASE_URL|POSTGRES_URL|PG_DATABASE_URL|PGHOST|DB_HOST|PGUSER|PGPASSWORD|DB_PASSWORD|PGDATABASE|DB_NAME|R2_|AWS_|CLOUDFLARE_)/.test(k))delete env[k];
const server=spawn(process.execPath,[resolve('dist-server/server.cjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
const token=(type,cid=a,staffId)=>{const body=Buffer.from(JSON.stringify({type,clinicId:cid,staffId,exp:Date.now()+3600000})).toString('base64url');return 'v1.'+body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');};
const admin=token('admin'),manager=token('manager');const base='http://127.0.0.1:'+port;
async function req(path,body,t=admin){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={text};}return {status:r.status,data,headers:r.headers};}
try{
 for(let i=0;;i++){try{await fetch(base);break;}catch{if(i>100)throw Error(log);await new Promise(r=>setTimeout(r,100));}}
 const search=await req('/api/patients/search?'+new URLSearchParams({clinicId:a,q:'fixture 219',scope:'booking'}),null,manager);assert.equal(search.status,200);assert.equal(search.data.items.length,1);assert.equal(search.data.items[0].id,'patient-219');
 const page=await req('/api/patients/search?'+new URLSearchParams({clinicId:a,q:'fixture',limit:'15',offset:'15'}),null,manager);assert.equal(page.data.items.length,15);assert.equal(page.data.total,221);
 assert.equal((await req('/api/patients/search?clinicId='+b+'&q=fixture',null,manager)).status,403);
 const stats=await req('/api/patients/stats?clinicId='+a+'&month=2026-11',null,manager);assert.equal(stats.data.total,221);assert.equal(stats.data.newThisMonth,221);
 console.log('PASS server-side patient lookup finds beyond first 100, bounded pages/counts, stats and cross-clinic rejection');
 const backup=await req('/api/backups',{action:'export_clinic',clinicId:a});assert.equal(backup.status,200);
 assert.equal((await req('/api/db',{action:'deleteDoc',path:'clinics',id:a},manager)).status,403);
 assert.equal((await req('/api/db',{action:'deleteDoc',path:'clinics',id:a})).status,200);
 let disk=JSON.parse(await readFile(join(dir,'local_db.json'),'utf8'));
 for(const table of [...tables,'files','clinics','finance_state']){assert(!disk[table].some(r=>(r.clinicId||r.clinicid)===a||r.id===a),table);assert(disk[table].some(r=>(r.clinicId||r.clinicid)===b||r.id===b),table+' other retained');}
 assert(!disk.server_sync_events.some(r=>r.clinic_id===a));assert(disk.server_sync_events.some(r=>r.clinic_id===b));
 assert.equal((await req('/api/finance',{clinicId:a,action:'read'},manager)).status,401);
 assert.equal((await req('/api/db',{action:'updateDoc',path:'clinics',id:a,data:{name:'Stale replay'}},manager)).status,401);
 assert.equal((await req('/api/db',{action:'setDoc',path:'clinics/'+a+'/patients',id:'orphan',data:{name:'Stale orphan'}},manager)).status,401);
 assert.equal((await req('/api/backups',{clinicId:a,action:'restore_clinic',backup:backup.data})).status,200);
 disk=JSON.parse(await readFile(join(dir,'local_db.json'),'utf8'));assert(disk.clinics.some(r=>r.id===a));assert(disk.teeth.some(r=>r.clinicId===a));assert(disk.xrays.some(r=>r.clinicId===a));assert(disk.finance_state.some(r=>r.id===a));
 console.log('PASS admin-only clinic cascade removes all owned DB tables including finance/teeth/xrays/files/sync; other clinic untouched; only backup restores history');
 // Isolated identities keep boundary tests independent of preceding fixture work.
 const readToken=token('staff',b,'limit-read');let r;
 for(let i=0;i<400;i++){r=await req('/api/db',{action:'getDocs',path:'clinics/' + b + '/patients'},readToken);assert.equal(r.status,200);}
 r=await req('/api/db',{action:'getDocs',path:'clinics/' + b + '/patients'},readToken);assert.equal(r.status,429);assert.equal(r.data.scope,'user');assert(Number(r.headers.get('retry-after'))>0);
 const writeToken=token('staff',b,'limit-write');
 for(let i=0;i<120;i++){r=await req('/api/db',{action:'invalid',path:'clinics/' + b + '/patients'},writeToken);assert.equal(r.status,400);}
 r=await req('/api/db',{action:'invalid',path:'clinics/' + b + '/patients'},writeToken);assert.equal(r.status,429);assert.equal(r.data.scope,'writes');
 assert.equal((await req('/api/db',{action:'getDocs',path:'clinics/' + b + '/patients'},token('staff',b,'other-user'))).status,200);
 console.log('PASS real HTTP middleware 400/user reads, 120/user writes, separate identities and Retry-After');
}finally{server.kill();await new Promise(r=>server.on('exit',r));await rm(dir,{recursive:true,force:true});}
