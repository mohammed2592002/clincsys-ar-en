import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import pg from 'pg';
// This test starts its own loopback-only PostgreSQL. It never consumes DATABASE_URL
// or connects to an existing server. Supply installed PostgreSQL binaries only.
const bin = process.env.TEST_PG_BIN;
assert(bin, 'Set TEST_PG_BIN to a directory containing initdb, pg_ctl and postgres');
const root = await mkdtemp(join(tmpdir(), 'finance-concurrency-'));
async function command(file, args) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0, output);
  return output;
}
const reserve = createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
let started = false, pool;
const clients = [];
try {
  await command(join(bin, 'initdb'), ['-D', join(root,'data'), '-A','trust','-U','fixture','--no-locale', ...(process.env.TEST_PG_SHARE ? ['-L',process.env.TEST_PG_SHARE] : [])]);
  await command(join(bin,'pg_ctl'), ['-D',join(root,'data'),'-l',join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${root} -F`,'-w','start']);
  started = true;
  const url = `postgresql://fixture@127.0.0.1:${port}/postgres`;
  for (const key of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME','PGSSLMODE','DB_SSL']) delete process.env[key];
  process.env.DATABASE_URL = url;
  // Export the actual production class in a temporary test bundle only. No test
  // endpoints, conditional bypasses or extra exports enter the shipped server.
  const apiSource = await readFile(resolve('api/index.ts'),'utf8');
  const bundle = join(resolve('node_modules'), `.finance-concurrency-${process.pid}.mjs`);
  try {
    await build({stdin:{contents:apiSource+'\nexport { PostgresDbClient };\n',resolveDir:resolve('api'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:bundle,logLevel:'silent'});
    const { PostgresDbClient, closeDatabase } = await import(pathToFileURL(bundle).href);
    const serviceBundle = join(root,'finance.mjs');
    await build({entryPoints:[resolve('api/finance.ts')],bundle:true,platform:'node',format:'esm',outfile:serviceBundle,logLevel:'silent'});
    const {createFinanceService} = await import(pathToFileURL(serviceBundle).href);
    pool = new pg.Pool({connectionString:url});
    for (const table of ['clinics','patients','appointments','shifts','expenses']) await pool.query(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, clinicId TEXT, data TEXT, createdAt TEXT)`);
    for (const cid of ['clinic-a','clinic-b']) {
      const records = {
        clinics:{id:cid,clinicId:cid,name:cid,isActive:true,paymentMethods:['كاش'],loyaltyProgramEnabled:false},
        patients:{id:cid+'-p',clinicId:cid,name:'Fixture patient'},
        appointments:{id:cid+'-app',clinicId:cid,patientId:cid+'-p',patientName:'Fixture patient',price:1000,paidAmount:0,remainingAmount:1000,payments:[],status:'completed'},
        shifts:{id:cid+'-shift',clinicId:cid,status:'open',date:'2026-11-22',startCash:0}
      };
      for (const [table,data] of Object.entries(records)) await pool.query(`INSERT INTO ${table}(id,clinicId,data) VALUES($1,$2,$3)`,[data.id,cid,JSON.stringify(data)]);
    }
    const db1 = new PostgresDbClient(), db2 = new PostgresDbClient(); clients.push(db1,db2);
    // A callback gate proves overlap without treating elapsed latency as a benchmark.
    let releaseGate, enteredGate, armed = true;
    const gate = new Promise(r=>releaseGate=r), entered = new Promise(r=>enteredGate=r);
    const execute1 = db1.execute.bind(db1);
    db1.execute = async input => {
      if(armed && typeof input==='object' && input.sql==='SELECT * FROM clinics WHERE id = ?' && input.args[0]==='clinic-a') {
        armed=false; enteredGate(); await gate;
      }
      return execute1(input);
    };
    const service = db => createFinanceService({db,getAuth:async()=>null,broadcast:()=>{}});
    const s1=service(db1),s2=service(db2);
    await Promise.all([s1.ensureSchema(),s2.ensureSchema()]);
    const pay=(s,cid,key,amount)=>s.run(cid,{type:'manager',clinicId:cid},{action:'collect',appointmentId:cid+'-app',requestId:key,amount,paymentMethod:'كاش'});
    const a=pay(s1,'clinic-a','cross-a',100); await entered;
    let timer;
    const deadline = new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Clinic B waited on paused clinic A')),3000));
    try { await Promise.race([pay(s1,'clinic-b','cross-b',100),deadline]); }
    finally {clearTimeout(timer);releaseGate();}
    await a;
    console.log('PASS different clinics overlap inside the SAME production database client');
    await Promise.all([pay(s1,'clinic-a','same-1',175),pay(s1,'clinic-a','same-2',125)]);
    console.log('PASS same-clinic parallel payments serialize safely in one client');
    const replay=await Promise.all([pay(s1,'clinic-a','duplicate',50),pay(s2,'clinic-a','duplicate',50)]);
    assert.equal(replay[0].receipt.id,replay[1].receipt.id);
    await assert.rejects(()=>pay(s2,'clinic-a','duplicate',51),e=>e.status===409);
    console.log('PASS simultaneous duplicate request across two database clients creates ONE receipt; changed payload conflicts');
    await Promise.all([pay(s1,'clinic-a','cross-client-1',25),pay(s2,'clinic-a','cross-client-2',25)]);
    // Inject a failure after the appointment write to prove the state and payment
    // roll back together, the lock releases, and retrying the same key works.
    const execute2=db2.execute.bind(db2); let fail=true;
    db2.execute=async input=>{if(fail && typeof input==='object' && input.sql.startsWith('INSERT INTO finance_receipts')){fail=false;throw Error('injected save failure');}return execute2(input);};
    await assert.rejects(()=>pay(s2,'clinic-a','rollback-retry',40),/injected save failure/);
    await pay(s2,'clinic-a','rollback-retry',40);
    for(const [cid,total,count] of [['clinic-a',540,7],['clinic-b',100,1]]) {
      const app=JSON.parse((await pool.query('SELECT data FROM appointments WHERE id=$1',[cid+'-app'])).rows[0].data);
      const state=await s1.exportState(cid);
      assert.equal(app.paidAmount,total);assert.equal(app.remainingAmount,1000-total);
      assert.equal(app.payments.length,count);assert.equal(state.receipts.length,count);
      assert.equal(new Set(state.receipts.map(x=>x.id)).size,count);
      assert.equal(new Set(state.receipts.map(x=>x.requestId)).size,count);
      assert.equal(state.receipts.reduce((sum,r)=>sum+r.amount,0),total);
      assert.equal(Object.keys(state.requests).length,count);
    }
    console.log('PASS exact final balances and receipt counts, rollback, lock release and same-key retry');
    await db1.financeTransaction('clinic-a', async () => {
      await db1.financeTransaction('clinic-a', async () => {
        assert.equal((await db1.execute('SELECT 1 AS value')).rows[0].value, 1);
      });
    });
    console.log('PASS nested transaction reuses its checked-out connection');
    await closeDatabase();
  } finally { await rm(bundle,{force:true}); }
} finally {
  for(const client of clients) await client.closePool();
  if(pool)await pool.end();
  if(started)await command(join(bin,'pg_ctl'),['-D',join(root,'data'),'-m','immediate','-w','stop']);
  await rm(root,{recursive:true,force:true});
}
console.log('PASS isolated PostgreSQL concurrency suite; no external database or live clinic contacted');
