import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { Transform, PassThrough } from 'node:stream';
import { once } from 'node:events';
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
  // Disposable/local databases must not inherit another database's restore
  // status merely because both processes share the operating-system temp dir.
  // Preserve the existing PostgreSQL report location for deployed jobs.
  const auditDir = () => deps.isPostgres?.() ? path.join(os.tmpdir(), 'system-restore-reports')
    : path.join(os.tmpdir(), 'system-restore-reports', 'local-' + crypto.createHash('sha256').update(path.resolve(process.cwd(), 'local_db.json')).digest('hex').slice(0, 24));
  const save = (job: any) => { fs.mkdirSync(auditDir(), { recursive: true }); fs.writeFileSync(path.join(auditDir(), job.id + '.json'), JSON.stringify(job)); };
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

  // Tickets are single-use, purpose-scoped, opaque and short-lived. Never
  // put a reusable login token in download URLs or log either kind of token.
  const tickets=new Map<string,{expires:number,job:string}>();
  const exports=new Map<string,any>();
  let exportBusy=false;
  const cleanup=()=>{const now=Date.now();for(const [key,t] of tickets)if(t.expires<now)tickets.delete(key);for(const [key,j] of exports)if(j.state!=='running'&&j.created<now-60*60*1000)exports.delete(key);};
  app.post('/api/system-backup/ticket',async(req:any,res:any)=>{
    if(!await authorized(req,res))return;cleanup();
    if(exportBusy)return res.status(409).json({message:'A system export is already running / يوجد تصدير شامل قيد التشغيل'});
    if(tickets.size>=100)return res.status(429).json({message:'Too many pending downloads'});
    const token=crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID();
    tickets.set(token,{expires:Date.now()+60000,job:id});exports.set(id,{id,state:'pending',created:Date.now(),bytes:0});
    res.setHeader('cache-control','no-store');
    res.json({id,downloadUrl:'/api/system-backup/download/'+token,fileName:'CMS_FULL_SYSTEM_BACKUP_'+new Date().toISOString().split('T')[0]+'.json.gz'});
  });
  app.get('/api/system-backup/export-status/:id',async(req:any,res:any)=>{
    if(!await authorized(req,res))return;cleanup();const job=exports.get(req.params.id);
    if(!job)return res.status(404).json({message:'Export status expired'});
    res.setHeader('cache-control','no-store');res.json(job);
  });
  async function sendExport(req:any,res:any,job:any) {
    if(exportBusy){job.state='failed';return res.status(409).json({message:'A system export is already running / يوجد تصدير شامل قيد التشغيل'});}
    exportBusy=true;job.state='running';const started=Date.now();const controller=new AbortController();
    const cancel=()=>{if(!res.writableFinished)controller.abort();};res.on('close',cancel);
    const source=new PassThrough({highWaterMark:64*1024});
    const gzip=createGzip({level:1});
    const meter=new Transform({transform(chunk,_enc,cb){job.bytes+=chunk.length;cb(null,chunk);}});
    res.setHeader('content-type','application/gzip');
    res.setHeader('content-disposition',`attachment; filename="CMS_FULL_SYSTEM_BACKUP_${new Date().toISOString().split('T')[0]}.json.gz"`);
    res.setHeader('cache-control','no-store, no-transform');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
    const log=(stage:string)=>console.info('[system-export]',JSON.stringify({id:job.id,stage,bytes:job.bytes,elapsedMs:Date.now()-started}));
    // Attach rejection handling immediately, before the producer does DB work.
    const transfer=pipeline(source,gzip,meter,res,{signal:controller.signal});transfer.catch(()=>{});
    const write=async(chunk:string)=>{if(controller.signal.aborted||source.destroyed)throw Error('Export connection closed');if(!source.write(chunk))await once(source,'drain',{signal:controller.signal});};
    try{
      log('started');
      await deps.backups.streamSystemExport(write,{signal:controller.signal,stage:(stage:string)=>{job.stage=stage;if(stage==='clinic')log('clinic');}});
      source.end();await transfer;job.state='completed';log('completed');
    }catch(e:any){
      job.state=controller.signal.aborted?'aborted':'failed';
      // Do not log database errors: they may contain a query or record values.
      log(job.state);controller.abort();source.destroy();await transfer.catch(()=>{});
    }finally{res.off('close',cancel);job.elapsedMs=Date.now()-started;exportBusy=false;}
  }
  app.get('/api/system-backup/download/:ticket',async(req:any,res:any)=>{
    await getReady();cleanup();const ticket=tickets.get(req.params.ticket);tickets.delete(req.params.ticket);
    if(!ticket||ticket.expires<Date.now())return res.status(403).json({message:'Download link expired or used'});
    await sendExport(req,res,exports.get(ticket.job));
  });
  // Keep the authenticated legacy route for older clients, with the same gate.
  app.get('/api/system-backup/export',async(req:any,res:any)=>{
    if(!await authorized(req,res))return;cleanup();const id=crypto.randomUUID();
    const job={id,state:'pending',created:Date.now(),bytes:0};exports.set(id,job);await sendExport(req,res,job);
  });

  app.get('/api/system-restore', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    let job = lastJobId ? jobs.get(lastJobId) : null;
    if (!job) { try { const files = fs.readdirSync(auditDir()).filter(f => f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(auditDir(), f)).mtimeMs })).sort((a, b) => b.m - a.m); if (files.length) job = JSON.parse(fs.readFileSync(path.join(auditDir(), files[0].f), 'utf8')); } catch {} }
    if (!job) return res.status(404).json({ message: 'No restore job' });
    res.json(job);
  });
  app.get('/api/system-restore/:id', async (req: any, res: any) => {
    if (!await authorized(req, res)) return;
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
    let job = jobs.get(req.params.id);
    if (!job) { try { job = JSON.parse(fs.readFileSync(path.join(auditDir(), req.params.id + '.json'), 'utf8')); } catch {} }
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
        // A platform archive can fill an absent account, never replace a live one
        // (same rule as the restore_system handler in backup.ts).
        for (const row of globals.superadminCredentials || []) {
          const existing = await deps.db.execute({ sql: 'SELECT id FROM superadmin_credentials WHERE id = ?', args: ['main'] });
          if (!existing.rows.length) {
            await deps.db.execute({ sql: 'INSERT INTO superadmin_credentials (id, email, password, updatedAt) VALUES (?, ?, ?, ?)', args: ['main', row.email, row.password, row.updatedAt || new Date().toISOString()] });
            job.superadminCredentialsFilled = true;
          }
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
