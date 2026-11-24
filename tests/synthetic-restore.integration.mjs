import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';

const FILE = process.argv[2];
if(!FILE)throw Error('Usage: node tests/synthetic-restore.integration.mjs fixture.json.gz');
const dir = await mkdtemp(join(tmpdir(), 'synbench-'));
await writeFile(join(dir, 'local_db.json'), '{}');
const reserve = net.createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
const env = {...process.env, NODE_ENV:'production', ALLOW_LOCAL_JSON_DB: '1',  PORT:String(port), AUTH_SECRET:'isolated-syn-test', SYNTHETIC_RESTORE_ENABLED:'demo-only', SYNTHETIC_RESTORE_LOCAL_TEST:'1'};
for (const k of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME']) delete env[k];
const server = spawn(process.execPath, [resolve('dist-server/server.cjs')], { cwd: dir, env, stdio: ['ignore','pipe','pipe'] });
let log=''; server.stdout.on('data',d=>log+=d); server.stderr.on('data',d=>log+=d);
const base = `http://127.0.0.1:${port}`;
let peakRSS = 0;
const poller = setInterval(() => {
  try {
    const s = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8');
    const m = s.match(/VmRSS:\s+(\d+) kB/);
    if (m) peakRSS = Math.max(peakRSS, +m[1]);
  } catch {}
}, 100);
try {
  let ready=false; for(let i=0;i<100;i++){try{await fetch(base);ready=true;break;}catch{} await new Promise(r=>setTimeout(r,100));}
  if(!ready) throw new Error('server not ready: ' + log);
  const login = await (await fetch(base + '/api/superadmin/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'admin@crowndent.com', password:'admin123' }) })).json();
  const token = login.token;
  if (!token) throw new Error('login failed: ' + JSON.stringify(login));
  const t0=Date.now();
  const res=await fetch(base+'/api/synthetic-restore',{method:'POST',headers:{'content-type':'application/gzip','authorization':'Bearer '+token},body:fs.createReadStream(FILE),duplex:'half'});
  const launch=await res.json();console.log('launch',res.status,launch);
  if(res.status!==202)throw Error(JSON.stringify(launch));
  let job;
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,1000));
    try{job=await(await fetch(base+launch.statusPath,{headers:{authorization:'Bearer '+token}})).json();}catch(e){console.log('status read retry',e.cause?.code);continue;}
    if(['completed','failed'].includes(job.state))break;
  }
  console.log(JSON.stringify({elapsedMs:Date.now()-t0,peakMeasuredRSS_MB:Math.round(peakRSS/1024),job}));
  if(job.state!=='completed')throw Error('Streaming restore did not complete');
  const saved=JSON.parse(await readFile(join(dir,'local_db.json'),'utf8'));
  if(job.verifiedCounts.renewals!==12*job.completedClinics)throw Error('Renewal count mismatch');
  console.log('persisted',JSON.stringify(Object.fromEntries(Object.entries(saved).filter(([k])=>['clinics','patients','appointments','prescriptions','shifts','renewals'].includes(k)).map(([k,v])=>[k,Array.isArray(v)?v.length:Object.keys(v).length]))));

} finally { clearInterval(poller); server.kill(); await new Promise(r=>server.on('exit',r)); await rm(dir, { recursive:true, force:true }); }
