// End-to-end test: boots the real built server (local JSON DB) and verifies the
// login lockout policy over HTTP for clinic manager, staff, and superadmin logins.
// Lock durations are scaled to 1s/2s/3s via LOGIN_LOCKOUT_DURATIONS_MS so the
// test runs fast; the policy shape (3 fails -> lock, escalation, reset) is the same.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}`;
const CLINIC_EMAIL = 'lockout-test@clinic.com';
const MANAGER_PASS = 'manager-secret-1';
const STAFF_PIN = '778899';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockout-e2e-'));
const seedClinic = {
  id: 'clinic_lockout_test',
  clinicId: 'clinic_lockout_test',
  data: JSON.stringify({
    id: 'clinic_lockout_test',
    email: CLINIC_EMAIL,
    password: MANAGER_PASS, // legacy plaintext on purpose: also exercises the verify+migrate path
    staffPin: STAFF_PIN,
    name: 'Lockout Test Clinic',
    staffMembers: [{ id: 'st1', name: 'Secretary', role: 'استقبال / مساعد', password: 'staff-secret-9' }]
  }),
  createdAt: new Date().toISOString()
};
fs.writeFileSync(path.join(tmpDir, 'local_db.json'), JSON.stringify({ clinics: [seedClinic] }, null, 2));

const server = spawn('node', [path.resolve('dist-server/server.cjs')], {
  cwd: tmpDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    LOGIN_LOCKOUT_DURATIONS_MS: '1000,2000,3000'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
      if (res.status === 200) return;
    } catch (e) {}
    await sleep(500);
  }
  throw new Error('Server did not start. Log:\n' + serverLog);
}

const clinicLogin = (password, role = 'manager') =>
  fetch(`${BASE}/api/auth/clinic-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CLINIC_EMAIL, password, role })
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));

const superadminLogin = (email, password) =>
  fetch(`${BASE}/api/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));

try {
  await waitForServer();

  // ===== Manager: 3 fails -> 1s lock (scaled from 15s), correct password blocked during lock =====
  let r = await clinicLogin('wrong-1');
  assert.equal(r.status, 401); assert.equal(r.body.attemptsLeft, 2);
  r = await clinicLogin('wrong-2');
  assert.equal(r.status, 401); assert.equal(r.body.attemptsLeft, 1);
  r = await clinicLogin('wrong-3');
  assert.equal(r.status, 429, '3rd failed attempt locks');
  assert.equal(r.body.locked, true);
  assert.equal(r.body.retryAfterSeconds, 1, 'first lock = 1s (scaled 15s)');
  assert.match(r.body.message, /محاولات خاطئة/);
  r = await clinicLogin(MANAGER_PASS);
  assert.equal(r.status, 429, 'correct password is rejected while locked');
  console.log('PASS manager: 3 fails -> lock, correct password blocked during lock');

  // ===== Staff/PIN of the same clinic is NOT affected by the manager lock =====
  r = await clinicLogin(STAFF_PIN, 'staff');
  assert.equal(r.status, 200, 'staff login works while manager is locked (per-role keys)');
  assert.equal(r.body.success, true);
  assert.ok(r.body.token);
  console.log('PASS staff: independent per-role lock, PIN login succeeds');

  // ===== After lock expiry, manager login succeeds and resets the counter =====
  await sleep(1200);
  r = await clinicLogin(MANAGER_PASS);
  assert.equal(r.status, 200, 'manager login works after lock expiry');
  assert.equal(r.body.success, true);
  assert.ok(r.body.token);
  // Counter was reset: next failures restart at round 1 (1s), not an escalation
  await clinicLogin('wrong-a');
  await clinicLogin('wrong-b');
  r = await clinicLogin('wrong-c');
  assert.equal(r.status, 429);
  assert.equal(r.body.retryAfterSeconds, 1, 'successful login reset the schedule to round 1');
  console.log('PASS manager: success after expiry, counter reset (next lock is round 1 again)');

  // ===== Escalation without an intervening success: 1s -> 2s -> 3s -> capped 3s =====
  await sleep(1200);
  await clinicLogin('wrong-a'); await clinicLogin('wrong-b');
  r = await clinicLogin('wrong-c');
  assert.equal(r.body.retryAfterSeconds, 2, 'second round = 2s (scaled 30s)');
  await sleep(2200);
  await clinicLogin('wrong-a'); await clinicLogin('wrong-b');
  r = await clinicLogin('wrong-c');
  assert.equal(r.body.retryAfterSeconds, 3, 'third round = 3s (scaled 60s)');
  await sleep(3200);
  await clinicLogin('wrong-a'); await clinicLogin('wrong-b');
  r = await clinicLogin('wrong-c');
  assert.equal(r.body.retryAfterSeconds, 3, 'fourth round stays capped');
  console.log('PASS manager: escalation 1s -> 2s -> 3s -> capped at 3s (scaled 15s -> 30s -> 60s cap)');

  // ===== Unknown email also counts toward the lockout (anti password-spraying) =====
  await sleep(3200);
  const unknownLogin = () =>
    fetch(`${BASE}/api/auth/clinic-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.com', password: 'x', role: 'manager' })
    }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  assert.equal((await unknownLogin()).status, 404);
  assert.equal((await unknownLogin()).status, 404);
  r = await unknownLogin();
  assert.equal(r.status, 429, 'unknown-email attempts also lock after 3');
  console.log('PASS manager: unknown email counts toward lockout');

  // ===== Staff role has its own lockout (password path) =====
  await clinicLogin('wrong-pin-1', 'staff');
  await clinicLogin('wrong-pin-2', 'staff');
  r = await clinicLogin('wrong-pin-3', 'staff');
  assert.equal(r.status, 429, 'staff role locks after its own 3 failures');
  await sleep(1200);
  r = await clinicLogin(STAFF_PIN, 'staff');
  assert.equal(r.status, 200, 'staff PIN works after lock expiry');
  console.log('PASS staff: independent lockout and recovery');

  // ===== Superadmin: same policy =====
  r = await superadminLogin('admin@crowndent.com', 'wrong');
  assert.equal(r.status, 200); assert.equal(r.body.success, false);
  await superadminLogin('admin@crowndent.com', 'wrong');
  r = await superadminLogin('admin@crowndent.com', 'wrong');
  assert.equal(r.status, 429, 'superadmin locks after 3 failures');
  r = await superadminLogin('admin@crowndent.com', 'admin123');
  assert.equal(r.status, 429, 'correct superadmin password blocked during lock');
  await sleep(1200);
  r = await superadminLogin('admin@crowndent.com', 'admin123');
  assert.equal(r.status, 200, 'superadmin login works after lock expiry');
  assert.equal(r.body.success, true);
  assert.ok(r.body.token);
  console.log('PASS superadmin: lock, blocked during lock, success after expiry');

  // ===== Legacy plaintext migration happened on successful logins (async scrypt write path) =====
  const dbFile = JSON.parse(fs.readFileSync(path.join(tmpDir, 'local_db.json'), 'utf8'));
  const storedClinic = JSON.parse(dbFile.clinics.find((c) => c.id === 'clinic_lockout_test').data);
  assert.ok(String(storedClinic.password).startsWith('scrypt$'), 'manager password migrated to async scrypt hash');
  console.log('PASS migration: plaintext clinic password was re-hashed with async scrypt on login');

  console.log('\nALL E2E LOCKOUT TESTS PASSED');
  server.kill('SIGTERM');
  process.exit(0);
} catch (err) {
  console.error('E2E FAILED:', err);
  console.error('--- server log tail ---');
  console.error(serverLog.split('\n').slice(-30).join('\n'));
  server.kill('SIGTERM');
  process.exit(1);
}
