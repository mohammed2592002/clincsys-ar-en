import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import pg from 'pg';
const bin=process.env.TEST_PG_BIN;assert(bin);const root=await mkdtemp(join(tmpdir(),'clinic-delete-pg-'));
async function command(file,args){const p=spawn(file,args,{stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);assert.equal(await new Promise(r=>p.on('exit',r)),0,out);}
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));let started=false,pool,closeDatabase;
const bundle=join(resolve('node_modules'),'.clinic-delete-'+process.pid+'.mjs');
try{
 await command(join(bin,'initdb'),['-D',join(root,'data'),'-A','trust','-U','fixture','--no-locale',...(process.env.TEST_PG_SHARE?['-L',process.env.TEST_PG_SHARE]:[])]);
 await command(join(bin,'pg_ctl'),['-D',join(root,'data'),'-l',join(root,'pg.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${root} -F`,'-w','start']);started=true;
 for(const key of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME','PGSSLMODE','DB_SSL'])delete process.env[key];process.env.DATABASE_URL=`postgresql://fixture@127.0.0.1:${port}/postgres`;
 const src=(await readFile(resolve('api/index.ts'),'utf8')).replace('  startSyncEventsCleanupScheduler();','  // scheduler omitted only from this disposable test bundle');await build({stdin:{contents:src+'\nexport {deleteClinicDatabase,dbClient,finance};',resolveDir:resolve('api'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:bundle,logLevel:'silent'});
 const api=await import(pathToFileURL(bundle));closeDatabase=api.closeDatabase;await api.initDb();await api.finance.ensureSchema();pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const tables=['users','patients','appointments','records','prescriptions','custom_medications','custom_categories','inventory','billing','closings','laboratories','lab_orders','lab_work_types','shifts','expenses','teeth','xrays','renewals'];
 for(const cid of ['delete-a','keep-b']){await pool.query('INSERT INTO clinics(id,clinicId,data)VALUES($1,$1,$2)',[cid,JSON.stringify({id:cid,name:cid})]);for(const t of tables)await pool.query(`INSERT INTO ${t}(id,clinicId,data)VALUES($1,$2,$3)`,[t+'-'+cid,cid,JSON.stringify({clinicId:cid})]);await pool.query('INSERT INTO files(path,clinicId,data)VALUES($1,$2,$3)',[cid+'.png',cid,'']);await pool.query('INSERT INTO finance_state(id,data)VALUES($1,$2)',[cid,'{}']);await pool.query('INSERT INTO server_sync_events(id,clinic_id,created_at)VALUES($1,$2,$3)',[cid,cid,Date.now()]);}
 // Historical JSON-only ownership must be removed as well.
 await pool.query('INSERT INTO teeth(id,data)VALUES($1,$2)',['legacy-tooth',JSON.stringify({clinic_id:'delete-a'})]);
 await pool.query("CREATE FUNCTION fixture_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic injected deletion failure'; END; $$");await pool.query('CREATE TRIGGER fixture_reject BEFORE DELETE ON xrays FOR EACH ROW EXECUTE FUNCTION fixture_reject_delete()');
 await assert.rejects(()=>api.deleteClinicDatabase('delete-a'),/synthetic injected/);
 for(const t of [...tables,'clinics'])assert.equal((await pool.query(`SELECT count(*) FROM ${t} WHERE clinicId=$1`,['delete-a'])).rows[0].count,'1',t+' rolled back');
 await pool.query('DROP TRIGGER fixture_reject ON xrays');
 await api.deleteClinicDatabase('delete-a');
 for(const t of [...tables,'files','clinics']){assert.equal((await pool.query(`SELECT count(*) FROM ${t} WHERE clinicId=$1`,['delete-a'])).rows[0].count,'0',t);assert.equal((await pool.query(`SELECT count(*) FROM ${t} WHERE clinicId=$1`,['keep-b'])).rows[0].count,'1',t);}
 assert.equal((await pool.query('SELECT count(*) FROM teeth WHERE id=$1',['legacy-tooth'])).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM finance_state WHERE id=$1',['delete-a'])).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM server_sync_events WHERE clinic_id=$1',['delete-a'])).rows[0].count,'0');
 console.log('PASS isolated real PostgreSQL clinic deletion: every owned table, legacy JSON ownership, unrelated rows preserved; injected mid-cascade error rolls everything back');
}finally{if(closeDatabase)await closeDatabase();if(pool)await pool.end();await rm(bundle,{force:true});if(started)await command(join(bin,'pg_ctl'),['-D',join(root,'data'),'-m','immediate','-w','stop']);await rm(root,{recursive:true,force:true});}
