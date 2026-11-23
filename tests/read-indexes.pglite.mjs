import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Optional isolated WASM PostgreSQL check. Install PGlite outside the app and
// pass its entrypoint as PGLITE_MODULE_PATH; no runtime dependency is added.
assert(process.env.PGLITE_MODULE_PATH, 'Set PGLITE_MODULE_PATH to an installed @electric-sql/pglite entrypoint');
const {PGlite} = await import(pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href);
const built = await build({entryPoints:['api/readIndexes.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {legacyReadIndexStatements, installLegacyReadIndexes} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const source = await readFile('api/index.ts','utf8');
const functions = source.match(/CREATE OR REPLACE FUNCTION json_extract[\s\S]*?\$\$ LANGUAGE plpgsql IMMUTABLE;/g);
assert.equal(functions?.length,3);
const db = new PGlite();
try {
  for (const sql of functions) await db.exec(sql);
  const statements=legacyReadIndexStatements();
  const tables=[...new Set(statements.map(s=>s.match(/ ON (\w+) /)[1]))];
  for (const table of tables) await db.exec(`CREATE TABLE ${table} (id text primary key, clinicId text, patientId text, data jsonb)`);
  await db.exec(`INSERT INTO patients SELECT 'p'||n, 'c'||(n%1000), null, jsonb_build_object('clinicId','c'||(n%1000),'clinic_id','c'||(n%1000)) FROM generate_series(1,30000) n`);
  await db.exec(`INSERT INTO patients VALUES ('legacy',null,null,'{"clinic_id":"target"}'), ('conflict','other',null,'{"clinicId":"target"}'), ('both',null,null,'{"clinicId":"target","clinic_id":"other"}'), ('orphan',null,null,'{}')`);
  const predicates = [
    `clinicId = 'target' OR json_extract(data, '$.clinicId') = 'target' OR json_extract(data, '$.clinic_id') = 'target'`,
    `clinicId != 'other' OR json_extract(data, '$.clinicId') != 'other' OR json_extract(data, '$.clinic_id') != 'other'`,
    `clinicId > 'c998' OR json_extract(data, '$.clinicId') > 'c998' OR json_extract(data, '$.clinic_id') > 'c998'`,
  ];
  await db.exec('ANALYZE patients');
  const beforePlan=(await db.query(`EXPLAIN (FORMAT JSON) SELECT * FROM patients WHERE ${predicates[0]}`)).rows[0]['QUERY PLAN'][0].Plan;
  assert.equal(beforePlan['Node Type'],'Seq Scan');
  const before=[];
  for (const p of predicates) before.push((await db.query(`SELECT id FROM patients WHERE ${p} ORDER BY id`)).rows);
  let executed=0;
  const adapter={getIsPostgres:()=>true,execute:async sql=>{executed++;return db.exec(sql);}};
  const count=await installLegacyReadIndexes(adapter);
  assert.equal(count, statements.length);
  await installLegacyReadIndexes(adapter); // Same migration work is retry-safe.
  assert.equal(executed,statements.length*2);
  let touched=false;
  assert.equal(await installLegacyReadIndexes({getIsPostgres:()=>false,execute:async()=>{touched=true;}}),0);
  assert.equal(touched,false);
  for(let i=0;i<predicates.length;i++) assert.deepEqual((await db.query(`SELECT id FROM patients WHERE ${predicates[i]} ORDER BY id`)).rows,before[i]);
  await db.exec('ANALYZE patients');
  const plan=(await db.query(`EXPLAIN (FORMAT JSON) SELECT * FROM patients WHERE ${predicates[0]}`)).rows[0]['QUERY PLAN'][0].Plan;
  assert.equal(plan['Node Type'],'Bitmap Heap Scan');
  assert.equal(plan.Plans[0]['Node Type'],'BitmapOr');
  assert.equal(plan.Plans[0].Plans.length,3);
  console.log(JSON.stringify({engine:'isolated WASM PostgreSQL (PGlite)',tables:tables.length,indexStatements:count,semanticsChecks:predicates.length,idempotent:true,beforePlan:beforePlan['Node Type'],plan:plan['Node Type'],branches:plan.Plans[0].Plans.map(p=>p['Node Type'])}));
} finally {await db.close();}
