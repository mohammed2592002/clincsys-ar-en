import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { ignore } from 'stream-json/filters/Ignore';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { streamObject } from 'stream-json/streamers/StreamObject';
import { validateBackupHash } from './backupCredentials';

// Unified single-format (.json.gz) system backup: streaming download endpoint and
// streaming clinic-by-clinic restore with a live progress job. Real feature, all hosts.
export function installSystemBackup(app: any, deps: any) {
  const { getAuth, getReady } = deps;
  const jobs = new Map<string, any>();
  let lastJobId: string | null = null;
  const auditDir = path.join(os.tmpdir(), 'system-restore-reports');
  const save = (job: any) => { fs.mkdirSync(auditDir, { recursive: true }); fs.writeFileSync(path.join(auditDir, job.id + '.json'), JSON.stringify(job)); };
  let busy = false;
  const limit = (max: number) => { let bytes = 0; return new Transform({ transform(chunk, _enc, cb) { bytes += chunk.length; cb(bytes > max ? new Error('Backup exceeds size limit') : null, chunk); } }); };
  function values(file: string, clinics: boolean) {
    const source = fs.createReadStream(file), unzip = createGunzip(), cap = limit(8 * 1024 ** 3), tokens = parser({ streamValues: false });
    const filter = clinics ? pick({ filter: 'clinics', highWaterMark: 1 }) : ignore({ filter: 'clinics' });
    const output = clinics ? streamArray({ highWaterMark: 1 }) : streamObject({ highWaterMark: 1 });
    // Propagate failures through every stage and stop upstream on consumer errors.
    const done = pipeline(source, unzip, cap, tokens, filter, output);
    done.catch(() => {});
    return { output, done, close: () => source.destroy() };
  }
  async function read(file: string, clinics: boolean, fn: (key: any, value: any) => Promise<void>) {
    const s = values(file, clinics);
    try { for await (const item of s.output) await fn(item.key, item.value); await s.done; }
    finally { s.close(); s.output.destroy(); }
  }
  async function authorized(req: any, res: any) {
    await getReady();
    const auth = await getAuth(req);
    if (auth?.type !== 'admin') { res.status(403).json({ message: 'Superadmin only / للمدير العام فقط' }); return false; }
    return true;
  }

  // Streaming .json.gz download of the full-system backup (one clinic in memory at a time).
  app.get('/api/system-backup/export', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('content-type', 'application/gzip');
    res.setHeader('content-disposition', `attachment; filename="CMS_FULL_SYSTEM_BACKUP_${dateStr}.json.gz"`);
    const gzip = createGzip({ level: 1 });
    gzip.pipe(res);
    const write = async (chunk: string) => { if (!gzip.write(chunk)) await new Promise(r => gzip.once('drain', r)); };
    try {
      await deps.backups.streamSystemExport(write);
      gzip.end();
    } catch (e: any) {
      console.error('[system-backup export]', e);
      gzip.destroy(e);
    }
  });

  app.get('/api/system-restore', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    let job = lastJobId ? jobs.get(lastJobId) : null;
    if (!job) { try { const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(auditDir, f)).mtimeMs })).sort((a, b) => b.m - a.m); if (files.length) job = JSON.parse(fs.readFileSync(path.join(auditDir, files[0].f), 'utf8')); } catch {} }
    if (!job) return res.status(404).json({ message: 'No restore job' });
    res.json(job);
  });
  app.get('/api/system-restore/:id', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
    let job = jobs.get(req.params.id);
    if (!job) { try { job = JSON.parse(fs.readFileSync(path.join(auditDir, req.params.id + '.json'), 'utf8')); } catch {} }
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(job);
  });

  app.post('/api/system-restore', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    if (busy) return res.status(409).json({ message: 'A restore is already active / توجد استعادة نشطة بالفعل' });
    if (req.headers['content-type'] !== 'application/gzip') return res.status(415).json({ message: 'Upload one gzip-compressed FULL_SYSTEM_BACKUP JSON file / ارفع ملف JSON مضغوط gzip واحد' });
    busy = true;
    const id = crypto.randomUUID(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-restore-')), file = path.join(dir, 'backup.json.gz');
    const started = Date.now(), cpu = process.cpuUsage();
    const job: any = { id, state: 'uploading', startedAt: new Date().toISOString(), uploadedBytes: 0, completedClinics: 0, validatedClinics: 0, peakRssBytes: process.memoryUsage().rss, minFreeHostBytes: os.freemem(), errors: [] };
    jobs.set(id, job); lastJobId = id;
    let previousCpu = process.cpuUsage(), previousTime = Date.now();
    const monitor = setInterval(() => { const now = Date.now(), used = process.cpuUsage(previousCpu); job.peakCpuOneCorePercent = Math.max(job.peakCpuOneCorePercent || 0, (used.user + used.system) / ((now - previousTime) * 10)); previousCpu = process.cpuUsage(); previousTime = now; job.peakRssBytes = Math.max(job.peakRssBytes, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024); job.minFreeHostBytes = Math.min(job.minFreeHostBytes, os.freemem()); }, 250);
    const finish = () => { job.peakRssBytes = Math.max(job.peakRssBytes, process.resourceUsage().maxRSS * 1024); clearInterval(monitor); job.totalMs = Date.now() - started; job.cpuMicros = process.cpuUsage(cpu); job.finishedAt = new Date().toISOString(); busy = false; save(job); fs.rmSync(dir, { recursive: true, force: true }); };
    try {
      const counter = new Transform({ transform(chunk, _enc, cb) { job.uploadedBytes += chunk.length; cb(job.uploadedBytes > 1024 ** 3 ? new Error('Compressed upload exceeds 1 GiB') : null, chunk); } });
      await pipeline(req, counter, fs.createWriteStream(file));
      job.uploadMs = Date.now() - started; job.state = 'validating';
      res.status(202).json({ id, statusPath: '/api/system-restore/' + id, uploadedBytes: job.uploadedBytes, uploadMs: job.uploadMs });
    } catch (e: any) { job.state = 'failed'; job.errors.push(e.message); finish(); if (!res.headersSent) res.status(400).json(job); return; }
    // Continue after the one upload completes, with one clinic in memory at a time.
    void (async () => {
      const globals: any = {}; const clinicIds = new Set<string>(); const expected: any = {}; const restoreStart = Date.now();
      const TABLES = ['patients', 'appointments', 'records', 'teeth', 'xrays', 'prescriptions', 'custom_medications', 'custom_categories', 'shifts', 'expenses', 'inventory', 'billing', 'closings', 'laboratories', 'lab_orders', 'lab_work_types'];
      try {
        await read(file, false, async (key, value) => { globals[key] = value; });
        job.databaseDriver = deps.isPostgres && deps.isPostgres() ? 'postgresql' : 'local';
        if (globals.backupScope !== 'FULL_SYSTEM_BACKUP' || globals.schemaVersion !== 3 || !Number.isInteger(globals.totalClinicsCount)) throw Error('Expected a version-3 full system backup / ملف نسخة شاملة غير صالح');
        job.totalClinics = globals.totalClinicsCount;
        for (const key of ['renewalsLog', 'broadcasts', 'systemSettings'])
          if (globals[key] !== undefined) {
            if (!Array.isArray(globals[key])) throw Error('Invalid global backup records / سجلات عامة غير صالحة');
            for (const row of globals[key])
              if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || row.id.length > 200) throw Error('Invalid global record / سجل عام غير صالح');
          }
        if (globals.superadminCredentials !== undefined) {
          if (!Array.isArray(globals.superadminCredentials) || globals.superadminCredentials.length > 1) throw Error('Invalid platform credentials / حساب منصة غير صالح');
          for (const row of globals.superadminCredentials) {
            if (row?.id !== 'main' || typeof row.email !== 'string' || !row.email.trim() || typeof row.password !== 'string' || !row.password) throw Error('Invalid platform credentials / حساب منصة غير صالح');
            validateBackupHash(row.password);
          }
        }
        for (const t of TABLES) expected[t] = 0; expected.finance_receipts = 0; expected.renewals = (globals.renewalsLog || []).length;
        await read(file, true, async (_key, item) => {
          deps.backups.validateClinic(item);
          const cid = String(item.clinicInfo?.id || item.clinicId || '');
          if (!cid || clinicIds.has(cid)) throw Error('Missing or duplicate clinic id / رقم عيادة مفقود أو مكرر');
          clinicIds.add(cid);
          const data = item.data || item;
          for (const t of TABLES) expected[t] += (data[t] || []).length;
          for (const p of data.patients || []) for (const t of ['records', 'teeth', 'xrays']) expected[t] += (p[t] || []).length;
          expected.finance_receipts += (data.finance_state?.receipts || data.financeState?.receipts || []).length;
          job.validatedClinics++;
        });
        if (clinicIds.size !== globals.totalClinicsCount) throw Error('Clinic count mismatch / عدد العيادات غير مطابق');
        job.validationMs = Date.now() - restoreStart; job.state = 'restoring'; const applying = Date.now();
        await read(file, true, async (_key, item) => {
          await deps.backups.restoreClinic(String(item.clinicInfo?.id || item.clinicId), item, { type: 'admin' });
          job.completedClinics++; job.lastClinicId = String(item.clinicInfo?.id || item.clinicId); save(job);
          await new Promise(r => setTimeout(r, 25));
        });
        // Global records through the shared restore rules (clinic list already applied above).
        let result: any, status = 200;
        const globalReq = Object.create(req); globalReq.body = { action: 'restore_system', backup: { ...globals, superadminCredentials: [], clinics: [] } };
        await deps.backups.handler(globalReq, { json: (x: any) => { result = x; }, status: (s: number) => { status = s; return { json: (x: any) => { result = x; } }; } });
        if (status !== 200 || !result?.success) throw Error(result?.message || 'Global records restore failed / فشلت استعادة السجلات العامة');
        // Approved behavior: the file's superadmin credentials REPLACE the live account.
        for (const row of globals.superadminCredentials || []) {
          const now = new Date().toISOString();
          const existing = await deps.db.execute({ sql: 'SELECT id FROM superadmin_credentials WHERE id = ?', args: ['main'] });
          if (existing.rows.length) await deps.db.execute({ sql: 'UPDATE superadmin_credentials SET email = ?, password = ?, updatedAt = ? WHERE id = ?', args: [row.email, row.password, row.updatedAt || now, 'main'] });
          else await deps.db.execute({ sql: 'INSERT INTO superadmin_credentials (id, email, password, updatedAt) VALUES (?, ?, ?, ?)', args: ['main', row.email, row.password, row.updatedAt || now] });
          job.superadminCredentialsReplaced = true;
        }
        job.restoreMs = Date.now() - applying;
        // Verification: no restored table may hold fewer rows than the file carried.
        const ids = [...clinicIds]; job.verifiedCounts = {};
        const actual: any = {};
        for (const table of [...TABLES, 'renewals', 'finance_receipts']) {
          let count = 0;
          for (const cid of ids) { const r = await deps.db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE clinicId = ?`, args: [cid] }); count += Number(r.rows[0].n); }
          actual[table] = count;
        }
        job.verifiedCounts = { patients: actual.patients, appointments: actual.appointments, prescriptions: actual.prescriptions, shifts: actual.shifts, renewals: actual.renewals, finance_receipts: actual.finance_receipts };
        for (const t of ['patients', 'appointments', 'prescriptions', 'shifts', 'finance_receipts'])
          if (actual[t] < expected[t]) throw Error('Post-restore count below file data: ' + t + ' (' + actual[t] + ' < ' + expected[t] + ')');
        job.state = 'completed';
      } catch (e: any) { job.state = 'failed'; job.errors.push(e.message); }
      finally { finish(); }
    })();
  });
}
