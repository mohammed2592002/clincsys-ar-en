const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.TEST_BASE;
const stubPort = Number(process.env.TEST_R2_STUB_PORT);
const dbDir = process.env.TEST_DB_DIR;

// Minimal R2/S3 stub: accepts any PUT (stores bytes + content-type by path) and
// serves stored objects under /pub/. The real server points at it via R2_ENDPOINT.
const objects = new Map();
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://stub');
    if (req.method === 'PUT') {
      objects.set(url.pathname, { body, contentType: req.headers['content-type'] || '' });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end('<PutObjectResult/>');
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/pub/')) {
      const key = url.pathname.slice('/pub'.length);
      // PUT stores path-style (/<bucket>/<key>); the public URL omits the bucket.
      const hit = objects.get(key)
        || objects.get('/test-bucket' + key)
        || [...objects.entries()].find(([p]) => p.endsWith(key))?.[1];
      if (!hit) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': hit.contentType });
      res.end(hit.body);
      return;
    }
    res.writeHead(405);
    res.end();
  });
});

const pngBytes = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d994d0000000049454e44ae426082',
  'hex',
);

async function login(email, password, role) {
  const r = await fetch(base + '/api/auth/clinic-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  }).then((r) => r.json());
  assert(r.success, 'login failed: ' + JSON.stringify(r));
  return { token: r.token, clinicId: r.clinic.id };
}

async function presign(token, payload) {
  const r = await fetch(base + '/api/get-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function confirm(token, payload) {
  const r = await fetch(base + '/api/confirm-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));
  const manager = await login('clinic-a@example.invalid', 'clinic-a-password', 'manager');
  assert.equal(manager.clinicId, 'direct_upload_clinic_a');

  let checks = 0;
  const failures = [];
  async function check(name, fn) {
    checks++;
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
  }

  let presignOk;

  await check('presign requires authentication (401 without token)', async () => {
    const r = await presign(null, { fileName: 'x.png', category: 'xrays', clinicId: manager.clinicId });
    assert.equal(r.status, 401);
  });

  await check('presign rejects a disallowed extension', async () => {
    const r = await presign(manager.token, { fileName: 'evil.exe', category: 'xrays', clinicId: manager.clinicId });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'file_type_not_allowed');
  });

  await check('presign rejects uploading into another clinic', async () => {
    const r = await presign(manager.token, { fileName: 'x.png', category: 'xrays', clinicId: 'some_other_clinic' });
    assert.equal(r.status, 403);
  });

  await check('presign returns a clinic-scoped key, public URL and signed content type', async () => {
    const r = await presign(manager.token, { fileName: 'xray.png', category: 'xrays', clinicId: manager.clinicId });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert(r.data.uploadUrl && r.data.publicUrl && r.data.key, JSON.stringify(r.data));
    assert.match(r.data.key, /^clinics\/direct_upload_clinic_a\/xrays\/\d+_[0-9a-f]{16}_xray\.png$/, r.data.key);
    assert.equal(r.data.contentType, 'image/png');
    assert(r.data.publicUrl.endsWith('/' + r.data.key), r.data.publicUrl);
    presignOk = r.data;
  });

  await check('browser PUT goes straight to R2 with the exact signed content type', async () => {
    const r = await fetch(presignOk.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presignOk.contentType },
      body: pngBytes,
    });
    assert.equal(r.status, 200, 'stub rejected the PUT: ' + r.status);
    const keyPath = '/' + 'test-bucket' + '/' + presignOk.key;
    const hit = objects.get(keyPath) || objects.get('/' + presignOk.key);
    assert(hit, 'stub never received the object. Seen: ' + [...objects.keys()].join(','));
    assert(hit.body.equals(pngBytes), 'stored bytes differ');
    assert.equal(hit.contentType, 'image/png');
  });

  await check('confirm requires authentication (401 without token)', async () => {
    const r = await confirm(null, { key: presignOk.key, clinicId: manager.clinicId });
    assert.equal(r.status, 401);
  });

  await check('confirm rejects a key outside the caller clinic', async () => {
    const r = await confirm(manager.token, { key: presignOk.key.replace('clinics/direct_upload_clinic_a/', 'clinics/other_clinic/'), clinicId: manager.clinicId });
    assert.equal(r.status, 403);
  });

  await check('confirm rejects a malformed key', async () => {
    const r = await confirm(manager.token, { key: '../../etc/passwd', clinicId: manager.clinicId });
    assert.equal(r.status, 400);
  });

  await check('confirm records the file with the owner clinic and derived mime', async () => {
    const r = await confirm(manager.token, { key: presignOk.key, clinicId: manager.clinicId });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.publicUrl, presignOk.publicUrl);
    assert.equal(r.data.mode, 'r2-direct');

    const dbPath = path.join(dbDir, 'local_db.json');
    let row = null;
    for (let i = 0; i < 30 && !row; i++) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      row = (db.files || []).find((f) => f.path === presignOk.publicUrl);
      if (!row) await new Promise((r2) => setTimeout(r2, 100));
    }
    assert(row, 'file row missing from files table');
    assert.equal(row.clinicId, 'direct_upload_clinic_a');
    assert.equal(row.mimeType, 'image/png');
  });

  await check('the public URL serves the uploaded bytes', async () => {
    const r = await fetch(presignOk.publicUrl);
    assert.equal(r.status, 200);
    const buf = Buffer.from(await r.arrayBuffer());
    assert(buf.equals(pngBytes));
  });

  await check('classic /api/upload still works and now stores through R2', async () => {
    const form = new FormData();
    form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'classic.png');
    form.append('category', 'xrays');
    form.append('clinicId', manager.clinicId);
    const r = await fetch(base + '/api/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + manager.token },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    assert.equal(r.status, 200, JSON.stringify(data));
    assert.equal(data.mode, 'r2', JSON.stringify(data));
    assert(data.publicUrl.includes('/clinics/direct_upload_clinic_a/xrays/'), data.publicUrl);
  });

  stub.close();
  if (failures.length) {
    console.log('FAILURES: ' + failures.join(' | '));
    process.exit(1);
  }
  console.log('All ' + checks + ' direct-upload checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
