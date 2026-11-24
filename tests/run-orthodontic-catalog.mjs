import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

// Separate server/database per case, including each language, avoids both data leakage and rate-limit changes.
if (!process.env.TEST_LANG) {
  for (const lang of ['ar', 'en']) {
    for (const mode of [{ TEST_EXISTING: '0' }, { TEST_EXISTING: '1' }, { TEST_MATERIAL_ONLY: '1' }, { TEST_EMPTY_ONLY: '1' }]) {
      const child = spawn(process.execPath, [resolve('tests/run-orthodontic-catalog.mjs')], {
        env: { ...process.env, TEST_LANG: lang, ...mode }, stdio: 'inherit',
      });
      if (await new Promise(r => child.on('exit', r)) !== 0) process.exit(1);
    }
  }
} else {
  const dir = await mkdtemp(join(tmpdir(), 'coredent-ortho-'));
  const reserve = net.createServer();
  await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise(r => reserve.close(r));
  const clinic = { id: 'finance_isolated_test', name: 'عيادة الاختبار المحلي', email: 'finance-isolated@example.invalid', password: 'test-only-password', isActive: true, subscriptionExpiresAt: '2030-01-01', staffMembers: [] };
  await writeFile(join(dir, 'local_db.json'), JSON.stringify({ clinics: [{ id: clinic.id, data: JSON.stringify(clinic) }] }));
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AUTH_SECRET: 'isolated-ortho-test-secret', TEST_BASE: `http://127.0.0.1:${port}` };
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'PG_DATABASE_URL', 'PGHOST', 'DB_HOST', 'PGUSER', 'PGPASSWORD', 'DB_PASSWORD', 'PGDATABASE', 'DB_NAME']) delete env[k];
  const server = spawn(process.execPath, [resolve('dist-server/server.cjs')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await fetch(env.TEST_BASE); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    if (!ready) throw Error('Isolated server did not start: ' + log);
    const child = spawn(process.execPath, [resolve('tests/orthodontic-catalog.ui.cjs')], { env, stdio: 'inherit' });
    if (await new Promise(r => child.on('exit', r)) !== 0) throw Error('Orthodontic catalog UI test failed. ' + log);
    console.log('Isolated test passed. No real clinic data was used or changed.');
  } finally {
    server.kill(); await new Promise(r => server.on('exit', r));
    await rm(dir, { recursive: true, force: true });
  }
}
