import assert from 'node:assert/strict';
import {build} from 'esbuild';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// PGlite runs the PostgreSQL engine, so casts, aggregates, parameters and
// JSON expressions use PostgreSQL semantics rather than a mocked SQL parser.
const {PGlite}=await import('@electric-sql/pglite');
const dir=await mkdtemp(join(tmpdir(),'renewals-pg-'));
let server,db;
try{
 const file=join(dir,'route.mjs');
 await build({entryPoints:[resolve('api/renewalsLog.ts')],outfile:file,bundle:true,format:'esm',platform:'node',packages:'external'});
 const {installRenewalsLog}=await import(pathToFileURL(file));
 db=new PGlite();await db.exec(`CREATE TABLE renewals(id text primary key,data text); CREATE FUNCTION json_extract(text,text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT $1::jsonb ->> replace($2,'$.','') $$;`);
 for(let i=0;i<25;i++)await db.query('INSERT INTO renewals VALUES($1,$2)',[`syn_${String(i).padStart(3,'0')}`,JSON.stringify({clinicName:i<12?'عيادة ألف':i===24?'100%_Clinic':"Beta O'Neil",renewedAt:'2026-11-23',amount:i+1,method:'card',synthetic:true})]);
 let statements=[];
 const app=express();installRenewalsLog(app,{getAuth:async req=>req.headers.authorization==='Bearer admin'?{type:'admin'}:req.headers.authorization==='Bearer clinic'?{type:'manager'}:null,db:{getIsPostgres:()=>true,execute:async({sql,args})=>{statements.push(sql);let i=0;return db.query(sql.replace(/\?/g,()=>'$'+(++i)),args);}}});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/superadmin/renewals`;
 const get=async(q='',auth='admin')=>{const r=await fetch(base+q,{headers:{authorization:'Bearer '+auth}});return {status:r.status,data:await r.json()};};
 assert.equal((await get('','none')).status,403);assert.equal((await get('','clinic')).status,403);
 let {data:a}=await get();assert.equal(a.items.length,10);assert.equal(a.total,25);assert.equal(a.totalRevenue,325);assert(a.hasMore);assert.equal(a.items[0].id,'syn_024');assert.equal(a.items[0].paymentMethod,'card');
 const {data:b}=await get('?offset=10'),{data:c}=await get('?offset=20');assert.equal(b.items.length,10);assert.equal(c.items.length,5);assert(!c.hasMore);assert.equal(new Set([...a.items,...b.items,...c.items].map(r=>r.id)).size,25);
 const {data:arabic}=await get('?q='+encodeURIComponent('عيادة'));assert.equal(arabic.total,12);assert.equal(arabic.totalRevenue,78);assert.equal(arabic.items.length,10);
 const {data:literal}=await get('?q='+encodeURIComponent('%_'));assert.equal(literal.total,1);
 const {data:quote}=await get('?q='+encodeURIComponent("O'Neil"));assert.equal(quote.total,12);
 const {data:none}=await get('?q=missing');assert.equal(none.total,0);assert.equal(none.totalRevenue,0);assert.deepEqual(none.items,[]);
 assert.equal((await get('?offset=-1')).status,400);assert.equal((await get('?offset=abc')).status,400);assert.equal((await get('?q='+('a'.repeat(201)))).status,400);
 assert(statements.filter(s=>s.startsWith('SELECT id,data')).every(s=>s.includes('LIMIT 10 OFFSET')));assert(statements.some(s=>s.includes('COUNT(*)')&&s.includes('SUM(')));
 console.log('PASS PostgreSQL engine API: authorization, fixed 10-row pages, deterministic ties, no duplicates, full count/sum, Arabic search across hidden rows, literal %/_, apostrophes, empty search results, invalid input. Row queries bounded by LIMIT 10.');
}finally{if(server)await new Promise(r=>server.close(r));if(db)await db.close();await rm(dir,{recursive:true,force:true});}
