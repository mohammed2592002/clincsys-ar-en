import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
const out = process.env.TEST_ARTIFACT_DIR || '/downloads/backup-credential-proof';
await mkdir(out, { recursive: true });
const secret = 'isolated-credential-test-signing-key';
const cid = 'credential_clinic_0';
const tests = [], pass = name => { tests.push(name); console.log('PASS ' + name); };
const passwords = { owner: 'طبيب اختبار recovery 2026', staff: 'Secretary-fixture-2026', second: 'Doctor-fixture-2026', pin: '927431', admin: 'Platform-fixture-2026' };
function hash(plain) { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + salt + '$' + crypto.scryptSync(plain, salt, 64).toString('hex'); }
function matches(stored, plain) { const [, salt, value] = stored.split('$'); return crypto.timingSafeEqual(Buffer.from(value, 'hex'), crypto.scryptSync(plain, salt, 64)); }
const hashed = Object.fromEntries(Object.entries(passwords).map(([key, value]) => [key, hash(value)]));
function signed(type, clinicId = cid, key = secret) { const body = Buffer.from(JSON.stringify({ type, clinicId, exp: Date.now() + 3600000 })).toString('base64url'); return 'v1.' + body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url'); }
const admin = signed('admin'), manager = signed('manager'), staff = signed('staff');
const profile = i => ({ id: 'credential_clinic_' + i, name: 'عيادة اختبار ' + i, email: 'recovery' + i + '@example.invalid', password: hashed.owner, staffPin: hashed.pin, isActive: true, subscriptionExpiresAt: '2030-01-01', staffMembers: [{ id: 'reception', name: 'Secretary', role: 'استقبال / مساعد', password: hashed.staff, allowedTabs: ['calendar'] }, { id: 'doctor', name: 'Doctor', role: 'طبيب', password: hashed.second, allowedTabs: ['patients'] }] });
const clinics = Array.from({ length: 200 }, (_, i) => profile(i));
clinics[0] = { ...clinics[0], password: passwords.owner, staffPin: Number(passwords.pin), data: { password: passwords.owner, staffPin: passwords.pin }, staffMembers: [{ ...clinics[0].staffMembers[0], password: passwords.staff, data: { password: passwords.staff } }, clinics[0].staffMembers[1]] };
const platform = { id: 'main', email: 'platform@example.invalid', password: passwords.admin, updatedAt: '2026-11-22T00:00:00Z' };
async function server(seed = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'credential-recovery-test-'));
    const reserve = net.createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
    const row = clinic => ({ id: clinic.id, data: JSON.stringify(clinic) });
    const seeded = { clinics: (seed.clinics || [{ id: 'test_bootstrap', name: 'Temporary test bootstrap' }]).map(row), patients: [{ id: 'test_sentinel', clinicId: 'test_bootstrap', data: '{}' }], ...(seed.platform ? { superadmin_credentials: [seed.platform] } : {}) };
    await writeFile(join(dir, 'local_db.json'), JSON.stringify(seeded));
    const authSecret = seed.authSecret || secret;
    const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AUTH_SECRET: authSecret };
    for (const key of Object.keys(env)) if (/^(DATABASE_URL|POSTGRES_URL|PG_DATABASE_URL|PGHOST|DB_HOST|PGUSER|PGPASSWORD|DB_PASSWORD|PGDATABASE|DB_NAME|R2_|AWS_|CLOUDFLARE_)/.test(key)) delete env[key];
    const child = spawn(process.execPath, [resolve('dist-server/server.cjs')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
    const base = 'http://127.0.0.1:' + port;
    for (let i = 0; ; i++) { try { await fetch(base); break; } catch { if (i > 100) throw Error(log); await new Promise(r => setTimeout(r, 100)); } }
    return { base, dir, adminToken: signed('admin', cid, authSecret), disk: async () => JSON.parse(await readFile(join(dir, 'local_db.json'), 'utf8')), close: async () => { child.kill(); await new Promise(r => child.on('exit', r)); await rm(dir, { recursive: true, force: true }); } };
}
async function request(server, path, body, token = admin, status = 200) {
    if (token === admin) token = server.adminToken;
    const response = await fetch(server.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    const result = await response.json();
    // Deliberately do not print request bodies: fixtures model credential-bearing files.
    assert.equal(response.status, status, path + ': ' + result.message);
    return result;
}
const backup = (server, action, extra = {}, token = admin, status = 200) => request(server, '/api/backups', { action, clinicId: cid, ...extra }, token, status);
async function login(server, email, password, role = 'manager') { const result = await request(server, '/api/auth/clinic-login', { email, password, role }); assert.equal(result.success, true); return result; }
async function logins(server, index = 0) { const email = profile(index).email; await login(server, email, passwords.owner); await login(server, email, passwords.staff, 'staff'); await login(server, email, passwords.second, 'staff'); await login(server, email, passwords.pin, 'staff'); }
async function emptyServer() { const s = await server({ authSecret: 'fresh-server-session-key-' + crypto.randomUUID() }); await request(s, '/api/db', { action: 'deleteDoc', path: 'clinics', id: 'test_bootstrap' }); assert.equal((await s.disk()).clinics.length, 0); return s; }
const source = await server({ clinics, platform });
try {
    const latestClinic = { ...profile(2), password: 'owner-changed-before-backup', staffMembers: [{ ...profile(2).staffMembers[0], password: 'staff-changed-before-backup' }, profile(2).staffMembers[1]] };
    await request(source, '/api/db', { action: 'setDoc', path: 'clinics', id: latestClinic.id, data: latestClinic });
    const before = await source.disk();
    const clinicFile = await backup(source, 'export_clinic', {}, manager);
    const staffFile = await backup(source, 'export_clinic', {}, staff);
    const full = await backup(source, 'export_system');
    const after = await source.disk();
    assert.deepEqual(after.clinics, before.clinics); assert.deepEqual(after.superadmin_credentials, before.superadmin_credentials);
    assert.equal(full.clinics.length, 200);
    for (const file of [clinicFile, staffFile]) {
        assert.equal(file.credentialSchemaVersion, 1); assert.equal(file.superadminCredentials, undefined);
        assert(matches(file.clinicInfo.password, passwords.owner)); assert(matches(file.clinicInfo.staffPin, passwords.pin));
        assert(matches(file.clinicInfo.staffMembers[0].password, passwords.staff)); assert.equal(file.clinicInfo.staffMembers[1].password, hashed.second);
        assert.equal(file.clinicInfo.data, undefined); assert.equal(file.clinicInfo.staffMembers[0].data, undefined);
        const text = JSON.stringify(file); for (const value of Object.values(passwords)) assert(!text.includes(value));
    }
    for (const file of [full, clinicFile, staffFile]) for (const value of [...Object.values(passwords), latestClinic.password, latestClinic.staffMembers[0].password]) assert(!JSON.stringify(file).includes(value));
    assert(matches(full.superadminCredentials[0].password, passwords.admin)); assert(!full.systemSettings.some(row => row.id === 'auth_secret'));
    pass('200-clinic platform export and manager/staff clinic exports contain valid hash+salt only; legacy plaintext/nested copies removed without mutating source credentials; existing hashes are not rehashed');
    const plainRead = await request(source, '/api/db', { action: 'getDoc', path: 'clinics', id: cid }, manager);
    assert.equal(plainRead.password, undefined); assert.equal(plainRead.staffPin, undefined); assert.equal(plainRead.staffMembers[0].data, undefined); assert(plainRead.staffMembers.every(member => member.password === undefined));
    await backup(source, 'restore_clinic', { backup: clinicFile }, staff, 403);
    await backup(source, 'restore_system', { backup: full }, manager, 403);
    pass('Normal data responses still hide hashes; staff restore and manager platform restore remain forbidden');
    for (const version of ['clinic', 'platform']) {
        const dest = await emptyServer();
        try {
            await request(dest, '/api/backups', { action: 'export_clinic', clinicId: cid }, manager, 401);
            if (version === 'clinic') await backup(dest, 'restore_clinic', { backup: clinicFile });
            else { const restored = await backup(dest, 'restore_system', { backup: full }); assert.equal(restored.restoredClinics.length, 200); }
            await logins(dest);
            if (version === 'platform') {
                await logins(dest, 99); await logins(dest, 199);
                await login(dest, latestClinic.email, latestClinic.password); await login(dest, latestClinic.email, latestClinic.staffMembers[0].password, 'staff');
                const result = await request(dest, '/api/superadmin/login', { email: platform.email, password: passwords.admin }); assert(result.success);
                const restored = await backup(dest, 'export_system'); assert.equal(restored.superadminCredentials[0].password, full.superadminCredentials[0].password);
                for (const item of full.clinics) { const current = restored.clinics.find(c => c.clinicInfo.id === item.clinicInfo.id); assert.equal(current.clinicInfo.password, item.clinicInfo.password); assert.equal(current.clinicInfo.staffPin, item.clinicInfo.staffPin); assert.deepEqual(current.clinicInfo.staffMembers, item.clinicInfo.staffMembers); }
            } else assert.equal((await dest.disk()).superadmin_credentials?.length || 0, 0);
            pass(version + ' restore into zero-clinic DB with a different session-signing key: original owner, secretary, doctor and shared PIN logins work; ' + (version === 'platform' ? '200 clinic hash sets match and superadmin login works' : 'clinic file never imports platform credentials'));
        } finally { await dest.close(); }
    }
    const changed = { ...profile(0), email: 'current-owner@example.invalid', password: hash('current-owner-password'), staffPin: hash('987654'), staffMembers: [{ id: 'reception', name: 'Current secretary', role: 'Current role', password: hash('current-staff-password'), allowedTabs: ['patients'] }, { id: 'post_backup', name: 'New staff after backup', role: 'staff', password: hash('post-backup-password') }] };
    const currentPlatform = { ...platform, email: 'current-platform@example.invalid', password: hash('current-platform-password') };
    const live = await server({ clinics: [changed], platform: currentPlatform });
    try {
        const before = await live.disk();
        const result = await backup(live, 'restore_clinic', { backup: clinicFile }, manager); assert(result.credentialNotice.en); assert(result.credentialNotice.ar);
        let restored = JSON.parse((await live.disk()).clinics.find(row => row.id === cid).data);
        for (const key of ['password', 'staffPin', 'email']) assert.equal(restored[key], changed[key]);
        assert.deepEqual(restored.staffMembers[0], changed.staffMembers[0]); assert.deepEqual(restored.staffMembers[1], changed.staffMembers[1]); assert(restored.staffMembers.some(member => member.id === 'doctor'));
        await login(live, changed.email, 'current-owner-password'); await login(live, changed.email, 'current-staff-password', 'staff'); await login(live, changed.email, '987654', 'staff'); await login(live, changed.email, 'post-backup-password', 'staff'); await login(live, changed.email, passwords.second, 'staff');
        await backup(live, 'restore_system', { backup: full }); assert.deepEqual((await live.disk()).superadmin_credentials, before.superadmin_credentials);
        assert((await request(live, '/api/superadmin/login', { email: currentPlatform.email, password: 'current-platform-password' })).success);
        pass('Existing DB keeps current owner email/password, PIN, staff roles/permissions/passwords, post-backup staff and platform credentials; missing staff recovered without resets or removals');
        const unchanged = JSON.stringify((await live.disk()).clinics);
        const malformed = structuredClone(clinicFile); malformed.clinicInfo.password = 'plaintext-must-not-import'; await backup(live, 'restore_clinic', { backup: malformed }, manager, 400);
        malformed.clinicInfo.password = 'scrypt$broken'; await backup(live, 'restore_clinic', { backup: malformed }, manager, 400);
        malformed.clinicInfo.password = 'SCRYPT$' + hashed.owner.slice('scrypt$'.length); await backup(live, 'restore_clinic', { backup: malformed }, manager, 400);
        const other = structuredClone(clinicFile); other.clinicId = 'another-clinic'; await backup(live, 'restore_clinic', { backup: other }, manager, 403);
        const row = structuredClone(clinicFile); row.data.patients.push({ id: 'forged-patient', clinicId: 'another-clinic', name: 'Invalid' }); await backup(live, 'restore_clinic', { backup: row }, manager, 403);
        const foreignRef = structuredClone(clinicFile); foreignRef.data.finance_state.requests.bad = { recordRef: { table: 'clinics', id: 'another-clinic' } }; await backup(live, 'restore_clinic', { backup: foreignRef }, manager, 403);
        const badAdmin = structuredClone(full); badAdmin.superadminCredentials[0].password = 'invalid'; await backup(live, 'restore_system', { backup: badAdmin }, admin, 400);
        assert.equal(JSON.stringify((await live.disk()).clinics), unchanged);
        const escalation = structuredClone(clinicFile); escalation.clinicInfo.staffMembers.push({ id: 'forged-admin', name: 'Test import', role: 'admin', password: hashed.staff, type: 'admin', isSuperAdmin: true, allowedTabs: ['settings'] }); escalation.clinicInfo.subscriptionExpiresAt = '2099-01-01'; escalation.superadminCredentials = [{ ...platform, password: hashed.admin }];
        await backup(live, 'restore_clinic', { backup: escalation }, manager);
        restored = JSON.parse((await live.disk()).clinics.find(row => row.id === cid).data); assert.equal(restored.subscriptionExpiresAt, changed.subscriptionExpiresAt);
        const imported = restored.staffMembers.find(member => member.id === 'forged-admin'); assert.equal(imported.type, undefined); assert.equal(imported.isSuperAdmin, undefined);
        // A staff label cannot turn a server-issued staff token into an admin token.
        const tokenResult = await login(live, changed.email, passwords.staff, 'staff'); assert.equal(JSON.parse(Buffer.from(tokenResult.token.split('.')[1], 'base64url')).type, 'staff');
        await backup(live, 'export_system', {}, tokenResult.token, 403);
        pass('Crafted files: malformed/plaintext hashes, mismatched clinic IDs, cross-clinic rows/references and malformed platform credentials rejected before writes; imported staff cannot gain platform access or change subscription grants');
    } finally { await live.close(); }
    await writeFile(join(out, 'credential-results.json'), JSON.stringify({ tests, syntheticClinicCount: 200, scope: 'Isolated real HTTP server with local database emulator; no production DB and no live PostgreSQL test', caveats: ['Passwords changed after a backup are unavailable in that older file on an empty DB', 'Files contain sensitive offline-attackable hashes, not encryption', 'Import guards enforce caller authority and scope; unsigned files do not prove their origin', 'Full-platform restore is atomic per clinic, not one transaction across every clinic'] }, null, 2));
} finally { await source.close(); }
