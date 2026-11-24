// Real PostgreSQL regression. Requires local initdb/pg_ctl, never a live DB URL.
// PG_TEST_BIN=/path/to/postgresql/bin npm run test:file-migrations
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';

const migration = '20261121_001_ensure_files_clinic_id';
const dir = await mkdtemp(join(tmpdir(), 'coredent-pg-migration-'));
const bin = process.env.PG_TEST_BIN;
assert(bin, 'Set PG_TEST_BIN to the directory containing initdb and pg_ctl');
const bundle = resolve(process.env.TEST_SERVER_BUNDLE || 'dist-server/server.cjs');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d994d0000000049454e44ae426082', 'hex');
async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
const pgPort = await freePort();
const cluster = join(dir, 'pg');
let started = false;
const admin = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', database: 'postgres' });
const cleanEnv = { ...process.env, NODE_ENV: 'production', AUTH_SECRET: 'isolated-migration-test-only' };
for (const k of ['DATABASE_URL','POSTGRES_URL','PG_DATABASE_URL','PGHOST','DB_HOST','PGUSER','DB_USER','PGPASSWORD','DB_PASSWORD','PGDATABASE','DB_NAME','PGSSLMODE','DB_SSL','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ENDPOINT','R2_BUCKET_NAME','R2_PUBLIC_URL']) delete cleanEnv[k];
async function boot(cwd, database) {
  const port = await freePort();
  const env = { ...cleanEnv, DATABASE_URL: `postgresql://postgres@127.0.0.1:${pgPort}/${database}`, PORT: String(port), TEST_BASE: `http://127.0.0.1:${port}`, TEST_LEGACY_PNG_B64: png.toString('base64') };
  const child = spawn(process.execPath, [bundle], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await new Promise(r => child.once('exit', r));
  };
  try {
    for (let i = 0; i < 150; i++) {
      try { await fetch(env.TEST_BASE); return { env, stop, log: () => log }; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    throw Error('Server did not start: ' + log);
  } catch (e) { await stop(); throw e; }
}
try {
  execFileSync(join(bin, 'initdb'), ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-locale'], { stdio: 'pipe' });
  execFileSync(join(bin, 'pg_ctl'), ['-D', cluster, '-l', join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${pgPort} -k ${dir}`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  await admin.connect();
  for (const scenario of ['legacy', 'fresh']) {
    const database = 'migration_' + scenario;
    await admin.query('CREATE DATABASE ' + database);
    const db = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', database });
    await db.connect();
    const cwd = join(dir, scenario);
    await mkdir(join(cwd, 'uploads'), { recursive: true });
    await writeFile(join(cwd, 'uploads', 'legacy_disk_xray.png'), png);
    let server;
    try {
      if (scenario === 'legacy') {
        await db.query(await readFile(resolve('schema.sql'), 'utf8'));
        await db.query('ALTER TABLE files DROP COLUMN IF EXISTS clinicId');
        await db.query('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT)');
        for (const id of ['20260810_001_initial_base_schema','20260810_002_fix_sync_events_bigint','20260811_001_remove_demo_data','20260815_001_ensure_renewals_clinic_id']) {
          await db.query('INSERT INTO schema_migrations VALUES ($1, $2)', [id, '2026-08-15T00:00:00Z']);
        }
        const absent = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='files' AND column_name='clinicid'");
        assert.equal(absent.rowCount, 0);
      }
      server = await boot(cwd, database);
      for (const [letter, staff] of [['a','A'],['b','B']]) {
        const clinic = { id: 'file_access_clinic_' + letter, name: 'Migration test ' + letter, email: `clinic-${letter}@example.invalid`, password: `clinic-${letter}-password`, isActive: true, subscriptionExpiresAt: '2030-01-01', staffMembers: [{ id: 'staff' + staff + '1', name: 'Test staff', role: 'استقبال', password: `staff-${letter}-password`, allowedTabs: ['calendar'] }] };
        await db.query('INSERT INTO clinics (id, clinicId, data) VALUES ($1, $1, $2)', [clinic.id, JSON.stringify(clinic)]);
      }
      await db.query('INSERT INTO files (path, mimeType, data) VALUES ($1,$2,$3),($4,$2,$5)', ['legacy_disk_xray.png','image/png','','legacy_db_xray.png',png.toString('base64')]);
      // Exercise the real upload and authenticated read endpoints first, so the
      // baseline demonstrates HTTP 500 when the legacy column is missing.
      const test = spawn(process.execPath, [resolve('tests/file-access.integration.cjs')], { env: server.env, stdio: 'inherit' });
      assert.equal(await new Promise(r => test.once('exit', r)), 0, scenario + ' upload/access regression; server log: ' + server.log());
      const applied = await db.query('SELECT count(*)::int AS n FROM schema_migrations WHERE id=$1', [migration]);
      assert.equal(applied.rows[0].n, 1, scenario + ' migration recorded exactly once');
      assert(!server.log().includes('Error in migration engine'), server.log());
      await server.stop();
      server = await boot(cwd, database);
      assert(server.log().includes('Migration already applied: ' + migration));
      assert(!server.log().includes('Error in migration engine'), server.log());
      const preserved = await db.query("SELECT count(*)::int AS n FROM files WHERE path LIKE 'legacy_%'");
      assert.equal(preserved.rows[0].n, 2, 'legacy file metadata preserved');
      console.log('PASS ' + scenario + ': upload/read/tenant isolation, migration once, clean restart, legacy metadata preserved');
    } finally {
      if (server) await server.stop();
      await db.end();
    }
  }
} finally {
  await admin.end().catch(() => {});
  if (started) execFileSync(join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  await rm(dir, { recursive: true, force: true });
}
