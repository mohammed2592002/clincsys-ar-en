// End-to-end test: boots the real built server and verifies graceful shutdown.
// A request whose body is still being uploaded (in flight) must complete after
// SIGTERM, new connections must be refused, and the process must exit with code 0.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = 4178;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-e2e-'));
fs.writeFileSync(path.join(tmpDir, 'local_db.json'), JSON.stringify({ clinics: [] }));

const server = spawn('node', [path.resolve('dist-server/server.cjs')], {
  cwd: tmpDir,
  env: { ...process.env, NODE_ENV: 'production', ALLOW_LOCAL_JSON_DB: '1',  PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
const exited = new Promise((resolve) => server.on('exit', (code, sig) => resolve({ code, sig })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tryConnect = () => new Promise((resolve) => {
  const s = net.connect(PORT, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

try {
  for (let i = 0; i < 60 && !(await tryConnect()); i++) await sleep(500);

  // Open a slow in-flight request: headers + half the body sent now.
  const body = JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(20) });
  const half = Math.floor(body.length / 2);
  const inflight = new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/auth/logout', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(body.slice(0, half));
    setTimeout(() => { // finish only after shutdown has started
      req.end(body.slice(half));
    }, 2000);
  });
  await sleep(300);

  const t0 = Date.now();
  server.kill('SIGTERM');
  await sleep(700);

  assert.equal(await tryConnect(), false, 'new connections must be refused during shutdown');
  console.log('PASS new connection refused while draining');

  const status = await inflight;
  assert.ok(status >= 200 && status < 600, 'in-flight request got a response');
  console.log(`PASS in-flight request completed during shutdown (HTTP ${status}, after ${Date.now() - t0}ms)`);

  const { code } = await exited;
  assert.equal(code, 0, 'clean exit code');
  assert.match(log, /Shutdown complete/);
  console.log(`PASS server exited cleanly (code ${code}) after draining`);

  // Drain timeout: a request that never finishes must not block exit forever.
  const server2 = spawn('node', [path.resolve('dist-server/server.cjs')], {
    cwd: tmpDir,
    env: { ...process.env, NODE_ENV: 'production', ALLOW_LOCAL_JSON_DB: '1',  PORT: String(PORT), SHUTDOWN_TIMEOUT_MS: '1500' },
    stdio: 'ignore'
  });
  const exited2 = new Promise((resolve) => server2.on('exit', (code) => resolve(code)));
  for (let i = 0; i < 60 && !(await tryConnect()); i++) await sleep(500);
  const stuck = http.request({ host: '127.0.0.1', port: PORT, path: '/api/auth/logout', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': 100 } });
  stuck.on('error', () => {});
  stuck.write('{');
  await sleep(300);
  const t1 = Date.now();
  server2.kill('SIGTERM');
  const code2 = await exited2;
  const took = Date.now() - t1;
  assert.equal(code2, 1);
  assert.ok(took >= 1400 && took < 4000, `forced exit near timeout (${took}ms)`);
  console.log(`PASS stuck request force-exited at drain timeout (${took}ms)`);
  console.log('ALL GRACEFUL SHUTDOWN TESTS PASSED');
} catch (e) {
  console.error('FAIL', e, '\nServer log:\n' + log);
  server.kill('SIGKILL');
  process.exitCode = 1;
}
