import { mkdtemp, writeFile, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
const dir = await mkdtemp(join(tmpdir(), 'coredent-clinic-delete-'));
await writeFile(join(dir, 'local_db.json'), '{}');
const dev = process.env.TEST_DEV === '1';
const reserve = net.createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
const env = {...process.env, NODE_ENV:dev?'development':'production', PORT:String(port), AUTH_SECRET:'isolated-clinic-delete-test-only', TEST_BASE:`http://127.0.0.1:${port}`};
for(const k of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME']) delete env[k];
if(dev) {
 for(const file of ['src','api','public','server.ts','vite.config.ts','tsconfig.json','index.html','package.json']) await cp(resolve(file),join(dir,file),{recursive:true});
 await symlink(resolve('node_modules'),join(dir,'node_modules'),'dir');
}
const server=spawn(process.execPath,dev?[resolve('node_modules/tsx/dist/cli.mjs'),join(dir,'server.ts')]:[resolve('dist-server/server.cjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
let log=''; server.stdout.on('data',d=>log+=d); server.stderr.on('data',d=>log+=d);
try {
 let ready=false; for(let i=0;i<100;i++){try{await fetch(env.TEST_BASE);ready=true;break;}catch{} await new Promise(r=>setTimeout(r,100));} if(!ready)throw Error(log);
 const test=spawn(process.execPath,[resolve(process.env.TEST_UI_ENTRY || 'tests/clinic-delete.ui.cjs')],{env,stdio:'inherit'});
 if(await new Promise(r=>test.on('exit',r))!==0)throw Error('Clinic delete UI regression failed');
} finally {server.kill(); await new Promise(r=>server.on('exit',r));await rm(dir,{recursive:true,force:true});}
