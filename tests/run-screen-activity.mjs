import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

// Separate server/database per case, including each language, avoids both data leakage and rate-limit changes.
if (!process.env.TEST_LANG) {
  for (const lang of ['ar', 'en']) {
      const child = spawn(process.execPath, [resolve('tests/run-screen-activity.mjs')], {
        env: { ...process.env, TEST_LANG: lang }, stdio: 'inherit',
      });
      if (await new Promise(r => child.on('exit', r)) !== 0) process.exit(1);
  }
} else {
  const dir = await mkdtemp(join(tmpdir(), 'coredent-patient-workspace-'));
  const reserve = net.createServer();
  await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise(r => reserve.close(r));
  const clinic = { id: 'finance_isolated_test', name: 'عيادة الاختبار المحلي', email: 'finance-isolated@example.invalid', password: 'test-only-password', isActive: true, subscriptionExpiresAt: '2030-01-01', staffMembers: [] };
  await writeFile(join(dir, 'local_db.json'), JSON.stringify({ clinics: [{ id: clinic.id, data: JSON.stringify(clinic) }] }));
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AUTH_SECRET: 'isolated-prescription-test-secret', TEST_BASE: `http://127.0.0.1:${port}` };
  for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'PG_DATABASE_URL', 'PGHOST', 'DB_HOST', 'PGUSER', 'PGPASSWORD', 'DB_PASSWORD', 'PGDATABASE', 'DB_NAME']) delete env[k];
  for (const key of Object.keys(env)) if (/^(R2_|AWS_|CLOUDFLARE_)/.test(key)) delete env[key];
  const server = spawn(process.execPath, [resolve('dist-server/server.cjs')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await fetch(env.TEST_BASE); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    if (!ready) throw Error('Isolated server did not start: ' + log);
    const child = spawn(process.execPath, [resolve('tests/screen-activity.ui.cjs')], { env, stdio: 'inherit' });
    if (await new Promise(r => child.on('exit', r)) !== 0) throw Error('Patient workspace UI test failed. ' + log);
    console.log('Isolated test passed. No real clinic data was used or changed.');
  } finally {
    server.kill(); await new Promise(r => server.on('exit', r));
    await rm(dir, { recursive: true, force: true });
  }
}
