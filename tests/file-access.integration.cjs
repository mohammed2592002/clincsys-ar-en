const assert = require('node:assert/strict');
const base = process.env.TEST_BASE;
const legacyPng = Buffer.from(process.env.TEST_LEGACY_PNG_B64, 'base64');

async function login(email, password, role) {
  const r = await fetch(base + '/api/auth/clinic-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  }).then((r) => r.json());
  assert(r.success, 'login failed for ' + email + ' ' + role + ': ' + JSON.stringify(r));
  return { token: r.token, clinicId: r.clinic.id };
}

async function upload(token, bytes, name, clinicId) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), name);
  form.append('category', 'xrays');
  if (clinicId) form.append('clinicId', clinicId);
  const r = await fetch(base + '/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function getFile(token, publicUrl) {
  const r = await fetch(base + publicUrl, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, buf };
}

(async () => {
  const managerA = await login('clinic-a@example.invalid', 'clinic-a-password', 'manager');
  const managerB = await login('clinic-b@example.invalid', 'clinic-b-password', 'manager');
  const staffA = await login('clinic-a@example.invalid', 'staff-a-password', 'staff');
  const staffB = await login('clinic-b@example.invalid', 'staff-b-password', 'staff');
  assert.equal(managerA.clinicId, 'file_access_clinic_a');
  assert.equal(managerB.clinicId, 'file_access_clinic_b');

  let checks = 0;
  const failures = [];
  async function check(name, fn) {
    checks++;
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
  }

  const secretBytes = Buffer.concat([legacyPng, Buffer.from('clinic-a-secret-payload')]);

  const upA = await upload(managerA.token, secretBytes, 'secret.png', managerA.clinicId);
  assert.equal(upA.status, 200, JSON.stringify(upA.data));
  assert.equal(upA.data.mode, 'local', 'test must exercise local storage mode: ' + JSON.stringify(upA.data));
  const urlA = upA.data.publicUrl;
  assert(urlA && urlA.startsWith('/api/files?path='), JSON.stringify(upA.data));

  await check('uploaded file names carry an unguessable random segment', async () => {
    const name = decodeURIComponent(urlA.split('path=')[1]);
    assert.match(name, /^\d+_[0-9a-f]{16}_secret\.png$/, name);
  });

  await check('owner clinic manager reads their own file', async () => {
    const r = await getFile(managerA.token, urlA);
    assert.equal(r.status, 200);
    assert(r.buf.equals(secretBytes), 'returned bytes differ');
  });

  await check('owner clinic staff reads their own file', async () => {
    const r = await getFile(staffA.token, urlA);
    assert.equal(r.status, 200);
    assert(r.buf.equals(secretBytes));
  });

  await check('other clinic manager cannot read the file (404, not 403)', async () => {
    const r = await getFile(managerB.token, urlA);
    assert.equal(r.status, 404, 'cross-tenant read returned ' + r.status);
  });

  await check('other clinic staff cannot read the file', async () => {
    const r = await getFile(staffB.token, urlA);
    assert.equal(r.status, 404, 'cross-tenant read returned ' + r.status);
  });

  await check('unauthenticated request is rejected', async () => {
    const r = await getFile(null, urlA);
    assert.equal(r.status, 401);
  });

  await check('upload with a spoofed foreign clinicId is rejected', async () => {
    const r = await upload(managerB.token, legacyPng, 'forged.png', managerA.clinicId);
    assert.equal(r.status, 403, 'spoofed upload returned ' + r.status);
  });

  await check('upload without clinicId is attributed to the caller clinic and isolated', async () => {
    const up = await upload(managerB.token, legacyPng, 'b-own.png');
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const own = await getFile(managerB.token, up.data.publicUrl);
    assert.equal(own.status, 200);
    const cross = await getFile(managerA.token, up.data.publicUrl);
    assert.equal(cross.status, 404, 'cross-tenant read returned ' + cross.status);
  });

  await check('legacy disk file without clinicId stays readable (backward compatibility)', async () => {
    const r = await getFile(managerB.token, '/api/files?path=' + encodeURIComponent('legacy_disk_xray.png'));
    assert.equal(r.status, 200);
    assert(r.buf.equals(legacyPng));
  });

  await check('legacy database-stored file without clinicId stays readable', async () => {
    const r = await getFile(managerB.token, '/api/files?path=' + encodeURIComponent('legacy_db_xray.png'));
    assert.equal(r.status, 200);
    assert(r.buf.equals(legacyPng));
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    console.error('FAILURES: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
