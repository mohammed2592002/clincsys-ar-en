const assert = require('node:assert/strict');
const http = require('node:http');

const base = process.env.TEST_BASE;
const stubPort = Number(process.env.TEST_R2_STUB_PORT);
const clinicA = process.env.TEST_CLINIC_A;
const clinicB = process.env.TEST_CLINIC_B;

// Minimal R2/S3 stub: records DELETEs and serves stored objects under /pub/.
// The real server points at it via R2_ENDPOINT, so no real R2 is ever touched.
const deletedKeys = [];
let failMode = true; // first round: one object refuses deletion
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://stub');
    if (req.method === 'DELETE') {
      const key = url.pathname.replace(/^\/[^/]+/, ''); // strip /test-bucket
      deletedKeys.push(key);
      if (failMode && key.includes('fail-me')) {
        res.writeHead(500, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>InternalError</Code></Error>');
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  });
});

async function superadminLogin() {
  const r = await fetch(base + '/api/superadmin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@crowndent.com', password: 'admin123' }),
  }).then((r) => r.json());
  assert(r.success && r.token, 'superadmin login failed: ' + JSON.stringify(r));
  return r.token;
}

async function clinicLogin() {
  const r = await fetch(base + '/api/auth/clinic-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'clinic-a@example.invalid', password: 'clinic-a-password', role: 'manager' }),
  }).then((r) => r.json());
  assert(r.success && r.token, 'clinic login failed: ' + JSON.stringify(r));
  return r.token;
}

const call = (method, path, token) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

(async () => {
  await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));
  const admin = await superadminLogin();
  const manager = await clinicLogin();

  // Auth: no token and clinic-manager token are both rejected on both endpoints.
  for (const token of [null, manager]) {
    const c = await call('GET', `/api/superadmin/clinics/${clinicA}/r2-files`, token);
    assert.equal(c.status, 403, `count with ${token ? 'clinic token' : 'no token'} must be 403`);
    const d = await call('POST', `/api/superadmin/clinics/${clinicA}/r2-files/delete`, token);
    assert.equal(d.status, 403, `delete with ${token ? 'clinic token' : 'no token'} must be 403`);
  }
  console.log('ok - superadmin-only auth enforced on count and delete');

  // Unknown clinic -> 404, weird id -> 400.
  const missing = await call('GET', '/api/superadmin/clinics/no_such_clinic/r2-files', admin);
  assert.equal(missing.status, 404, 'unknown clinic must be 404');
  const weird = await call('GET', '/api/superadmin/clinics/bad%2Fid/r2-files', admin);
  assert.equal(weird.status, 400, 'invalid clinic id must be 400');
  console.log('ok - unknown clinic 404 and invalid id 400');

  // Count: 3 deletable objects, 1 ownership-rejected row, local file ignored.
  const countA = await call('GET', `/api/superadmin/clinics/${clinicA}/r2-files`, admin);
  assert.equal(countA.status, 200);
  assert.equal(countA.data.count, 3, 'count must be the 3 verified R2 objects');
  assert.equal(countA.data.skipped, 1, 'the tampered row must be reported as skipped');
  const countB = await call('GET', `/api/superadmin/clinics/${clinicB}/r2-files`, admin);
  assert.equal(countB.data.count, 1, 'clinic B has its own single object');
  console.log('ok - count reports verified objects and skipped tampered row');

  // Round 1: one object fails in the stub; partial failure must be reported honestly.
  const del1 = await call('POST', `/api/superadmin/clinics/${clinicA}/r2-files/delete`, admin);
  assert.equal(del1.status, 200);
  assert.equal(del1.data.success, false, 'partial failure must not claim success');
  assert.equal(del1.data.deleted, 2, 'two objects deleted in round 1');
  assert.equal(del1.data.failed, 2, 'one stub failure + one ownership rejection');
  const failedKeys = (del1.data.failures || []).map((f) => f.key).sort();
  assert.ok(failedKeys.some((k) => k.includes('fail-me')), 'stub failure listed');
  assert.ok(failedKeys.some((k) => k.includes('stolen')), 'ownership rejection listed');
  console.log('ok - partial failure reported with per-object reasons');

  // Ownership: the stub must never receive a DELETE for clinic B objects,
  // the tampered key, or the local-disk file.
  assert.ok(!deletedKeys.some((k) => k.includes(clinicB)), 'no clinic B object may be deleted');
  assert.ok(!deletedKeys.some((k) => k.includes('stolen')), 'tampered key must never reach R2');
  assert.ok(!deletedKeys.some((k) => k.includes('local-xray')), 'local files must never reach R2');
  const uniqueDeleted = new Set(deletedKeys);
  assert.ok(uniqueDeleted.has(`/clinics/${clinicA}/xrays/aaa-f1.png`), 'f1 deleted');
  assert.ok(uniqueDeleted.has(`/clinics/${clinicA}/xrays/aaa-f2.png`), 'f2 deleted');
  assert.ok(uniqueDeleted.has(`/clinics/${clinicA}/xrays/aaa-fail-me.png`), 'fail-me attempted');
  console.log('ok - only verified clinic A objects reached the R2 stub');

  // Database rows are preserved: the cleanup touches R2 storage only.
  const countAfter = await call('GET', `/api/superadmin/clinics/${clinicA}/r2-files`, admin);
  assert.equal(countAfter.data.count, 3, 'files table rows must remain after cleanup');
  console.log('ok - database file records preserved');

  // Round 2: stub healthy again, the remaining objects delete cleanly.
  failMode = false;
  const del2 = await call('POST', `/api/superadmin/clinics/${clinicA}/r2-files/delete`, admin);
  assert.equal(del2.data.success, false, 'tampered row keeps success honest');
  assert.equal(del2.data.deleted, 3, 'all three verified objects deleted');
  assert.equal(del2.data.failed, 1, 'only the ownership-rejected row still fails');
  assert.ok((del2.data.failures || []).every((f) => f.error === 'ownership_unverified'), 'only ownership rejections remain');
  console.log('ok - retry after transient failure deletes the rest');

  // Clinic B is untouched.
  const countB2 = await call('GET', `/api/superadmin/clinics/${clinicB}/r2-files`, admin);
  assert.equal(countB2.data.count, 1, 'clinic B objects untouched');
  console.log('ok - other clinics untouched');

  console.log('R2 clinic cleanup regression: all checks passed');
  stub.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  stub.close();
  process.exit(1);
});
