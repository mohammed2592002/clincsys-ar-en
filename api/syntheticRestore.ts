import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { ignore } from 'stream-json/filters/Ignore';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { streamObject } from 'stream-json/streamers/StreamObject';

// Explicit opt-in, demo-host-only load-test route. No production behavior changes.
export function installSyntheticRestore(app:any, deps:any) {
  const {getAuth,getReady,isPostgres}=deps;
  const jobs = new Map<string,any>();
  const auditDir=path.join(os.tmpdir(),'synthetic-restore-reports');
  const save=(job:any)=>{fs.mkdirSync(auditDir,{recursive:true});fs.writeFileSync(path.join(auditDir,job.id+'.json'),JSON.stringify(job));};
  let busy = false;
  const enabled = (req:any) => process.env.SYNTHETIC_RESTORE_ENABLED === 'demo-only' &&
    ['demo.coredentsys.cloud','127.0.0.1','localhost'].includes(req.hostname);
  const limit = (max:number) => { let bytes=0; return new Transform({transform(chunk,_enc,cb){bytes+=chunk.length; cb(bytes>max?new Error('Backup exceeds size limit'):null,chunk);}}); };
  function values(file:string,clinics:boolean) {
    const source=fs.createReadStream(file), unzip=createGunzip(), cap=limit(8*1024**3), tokens=parser({streamValues:false});
    const filter=clinics?pick({filter:'clinics',highWaterMark:1}):ignore({filter:'clinics'});
    const output=clinics?streamArray({highWaterMark:1}):streamObject({highWaterMark:1});
    // Propagate failures through every stage and stop upstream on consumer errors.
    const done=pipeline(source,unzip,cap,tokens,filter,output);
    done.catch(()=>{});
    return {output,done,close:()=>source.destroy()};
  }
  async function read(file:string,clinics:boolean,fn:(key:any,value:any)=>Promise<void>) {
    const s=values(file,clinics);
    try { for await(const item of s.output) await fn(item.key,item.value); await s.done; }
    finally { s.close(); s.output.destroy(); }
  }
  async function authorized(req:any,res:any) {
    if(!enabled(req)){res.status(404).end();return false;}
    await getReady();
    const auth=await getAuth(req);
    if(auth?.type!=='admin'){res.status(403).json({message:'Superadmin only'});return false;}
    return true;
  }
  app.get('/api/synthetic-restore/:id',async(req:any,res:any)=>{
    if(!await authorized(req,res))return;
    if(!/^[0-9a-f-]{36}$/.test(req.params.id))return res.status(404).end();
    let job=jobs.get(req.params.id);
    if(!job){try{job=JSON.parse(fs.readFileSync(path.join(auditDir,req.params.id+'.json'),'utf8'));}catch{}}
    if(!job)return res.status(404).json({message:'Job not found'});
    res.json(job);
  });
  app.post('/api/synthetic-restore',async(req:any,res:any)=>{
    if(!await authorized(req,res))return;
    if(!isPostgres() && process.env.SYNTHETIC_RESTORE_LOCAL_TEST!=='1')return res.status(409).json({message:'PostgreSQL required; in-memory fallback is unsafe for this test'});
    if(busy)return res.status(409).json({message:'A restore is already active'});
    if(req.headers['content-type']!=='application/gzip')return res.status(415).json({message:'Upload one gzip-compressed FULL_SYSTEM_BACKUP JSON file'});
    busy=true;
    const id=crypto.randomUUID(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-restore-')),file=path.join(dir,'backup.json.gz');
    const started=Date.now(),cpu=process.cpuUsage();
    const job:any={id,state:'uploading',startedAt:new Date().toISOString(),uploadedBytes:0,completedClinics:0,validatedClinics:0,peakRssBytes:process.memoryUsage().rss,minFreeHostBytes:os.freemem(),errors:[]};
    jobs.set(id,job);
    let previousCpu=process.cpuUsage(),previousTime=Date.now();
    const monitor=setInterval(()=>{const now=Date.now(),used=process.cpuUsage(previousCpu);job.peakCpuOneCorePercent=Math.max(job.peakCpuOneCorePercent||0,(used.user+used.system)/((now-previousTime)*10));previousCpu=process.cpuUsage();previousTime=now;job.peakRssBytes=Math.max(job.peakRssBytes,process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);job.minFreeHostBytes=Math.min(job.minFreeHostBytes,os.freemem());},250);
    const finish=()=>{job.peakRssBytes=Math.max(job.peakRssBytes,process.resourceUsage().maxRSS*1024);clearInterval(monitor);job.totalMs=Date.now()-started;job.cpuMicros=process.cpuUsage(cpu);job.finishedAt=new Date().toISOString();busy=false;save(job);fs.rmSync(dir,{recursive:true,force:true});};
    try {
      const counter=new Transform({transform(chunk,_enc,cb){job.uploadedBytes+=chunk.length;cb(job.uploadedBytes>1024**3?new Error('Compressed upload exceeds 1 GiB'):null,chunk);}});
      await pipeline(req,counter,fs.createWriteStream(file));
      job.uploadMs=Date.now()-started;job.state='validating';
      res.status(202).json({id,statusPath:'/api/synthetic-restore/'+id,uploadedBytes:job.uploadedBytes,uploadMs:job.uploadMs});
    } catch(e:any){job.state='failed';job.errors.push(e.message);finish();if(!res.headersSent)res.status(400).json(job);return;}
    // Continue after the one upload completes, with one clinic in memory at a time.
    void (async()=>{
      const globals:any={};const clinicIds=new Set<string>();const restoreStart=Date.now();
      try {
        await read(file,false,async(key,value)=>{globals[key]=value;});
        job.databaseDriver=isPostgres()?'postgresql':'local-test';
        if(globals.backupScope!=='FULL_SYSTEM_BACKUP'||globals.schemaVersion!==3||globals.totalClinicsCount!==200 && process.env.SYNTHETIC_RESTORE_LOCAL_TEST!=='1')throw Error('Expected version-3 200-clinic full backup');
        if((globals.superadminCredentials||[]).length||(globals.broadcasts||[]).length||(globals.systemSettings||[]).length)throw Error('Synthetic file must not change platform accounts/settings/announcements');
        for(const row of globals.renewalsLog||[])if(!row.id?.startsWith('syn_clinic_')||!row.clinicId?.startsWith('syn_clinic_')||row.synthetic!==true||row.amount!==500)throw Error('Invalid synthetic subscription');
        await read(file,true,async(_key,item)=>{
          deps.backups.validateClinic(item);
          if(process.env.SYNTHETIC_RESTORE_LOCAL_TEST!=='1'&&(item.patients?.length!==1000||item.appointments?.length!==7300||item.prescriptions?.length!==1000||item.shifts?.length!==365||item.finance_state?.receipts?.length!==7300))throw Error('Synthetic data count mismatch');
          const cid=item.clinicInfo?.id;
          if(!cid?.startsWith('syn_clinic_')||item.clinicInfo.synthetic!==true||clinicIds.has(cid))throw Error('Invalid or duplicate synthetic clinic');
          if((await deps.db.execute({sql:'SELECT id FROM clinics WHERE id = ?',args:[cid]})).rows.length)throw Error('Synthetic clinic already exists: '+cid);
          for(const [key,rows] of Object.entries(item))if(Array.isArray(rows))for(const row of rows as any[])if(!row.id?.startsWith(cid+'_')||row.synthetic!==true)throw Error('Untagged synthetic record: '+key);
          for(const r of item.finance_state?.receipts||[])if(!r.id?.startsWith(cid+'_')||r.clinicId!==cid||r.synthetic!==true||r.amountCents!==25000)throw Error('Invalid synthetic receipt');
          clinicIds.add(cid);job.validatedClinics++;
        });
        if(clinicIds.size!==globals.totalClinicsCount)throw Error('Clinic count mismatch');
        for(const cid of clinicIds){const rs=(globals.renewalsLog||[]).filter((r:any)=>r.clinicId===cid);if(rs.length!==12||rs.reduce((n:number,r:any)=>n+r.amount,0)!==6000)throw Error('Subscription count mismatch');}
        for(const r of globals.renewalsLog||[])if(!clinicIds.has(r.clinicId))throw Error('Subscription references unknown clinic');
        job.validationMs=Date.now()-restoreStart;job.state='restoring';const applying=Date.now();
        await read(file,true,async(_key,item)=>{
          if(os.freemem()<512*1024**2||process.memoryUsage().rss>1536*1024**2)throw Error('Stopped between clinics to protect server memory');
          await deps.backups.restoreClinic(item.clinicInfo.id,item,{type:'admin'});
          job.completedClinics++;job.lastClinicId=item.clinicInfo.id;save(job);
          await new Promise(r=>setTimeout(r,25));
        });
        let result:any,status=200;
        const globalReq=Object.create(req);globalReq.body={action:'restore_system',backup:{...globals,clinics:[]}};
        await deps.backups.handler(globalReq,{json:(x:any)=>{result=x;},status:(s:number)=>{status=s;return {json:(x:any)=>{result=x;}};}});
        if(status!==200||!result?.success)throw Error(result?.message||'Global subscriptions restore failed');
        job.restoreMs=Date.now()-applying;
        const ids=[...clinicIds];job.verifiedCounts={};
        for(const table of ['patients','appointments','prescriptions','shifts','renewals','finance_receipts']){let count=0;for(const cid of ids){const result=await deps.db.execute({sql:`SELECT COUNT(*) AS n FROM ${table} WHERE clinicId = ?`,args:[cid]});count+=Number(result.rows[0].n);}job.verifiedCounts[table]=count;}
        const expected:any={patients:1000,appointments:7300,prescriptions:1000,shifts:365,renewals:12,finance_receipts:7300};
        for(const [table,n] of Object.entries(expected))if(job.verifiedCounts[table]!==Number(n)*ids.length)throw Error('Post-restore count mismatch: '+table);
        job.state='completed';
      }catch(e:any){job.state='failed';job.errors.push(e.message);}
      finally{finish();}
    })();
  });
}
