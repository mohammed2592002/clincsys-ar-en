import crypto from 'node:crypto';
import { checkExportMemory, LEGACY_FINANCE_MAX_BYTES, EXPORT_WRITE_BYTES } from './exportLimits';
import {isDeepStrictEqual} from 'node:util';

const groups = ['receipts','events','requests','assignments'] as const;
const table = (group: string) => 'finance_' + group;
const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
const key = (...parts: string[]) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const payload = (row: any) => parse(row.data);
const clone = (value: any) => JSON.parse(JSON.stringify(value));

// Exact payloads, ordinal array keys and exact map keys are authoritative.
// Projected columns are only query helpers, never a new interpretation of money.
export function createFinanceStore(db: any) {
  let ready: Promise<void> | undefined;
  async function schema() {
    if (!ready) ready = db.financeTransaction('__finance_schema__',async () => {
      await db.execute('CREATE TABLE IF NOT EXISTS finance_state (id TEXT PRIMARY KEY, data TEXT, createdAt TEXT)');
      await db.execute('CREATE TABLE IF NOT EXISTS finance_meta (id TEXT PRIMARY KEY, data TEXT)');
      for(const kind of ['receipts','events','expenses','appointments']) {
        await db.execute(`CREATE TABLE IF NOT EXISTS finance_view_${kind} (id TEXT PRIMARY KEY, clinicId TEXT, ordinal INTEGER, patientId TEXT, patientAlias TEXT, appointmentId TEXT, shiftId TEXT, patientPhone TEXT, patientName TEXT, date TEXT, data TEXT)`);
        if(db.getIsPostgres())for(const col of ['date','patientId','patientAlias','appointmentId','shiftId','patientPhone','patientName']) await db.execute(`CREATE INDEX IF NOT EXISTS idx_finance_view_${kind}_${col} ON finance_view_${kind} (clinicId, ${col})`);
      }
      for (const group of groups) {
        await db.execute(`CREATE TABLE IF NOT EXISTS ${table(group)} (id TEXT PRIMARY KEY, clinicId TEXT, entryKey TEXT, ordinal INTEGER, patientId TEXT, appointmentId TEXT, shiftId TEXT, collectionDate TEXT, originalReceiptId TEXT, data TEXT)`);
        if (db.getIsPostgres()) {
          for (const col of ['ordinal','patientId','appointmentId','shiftId','collectionDate','originalReceiptId'])
            await db.execute(`CREATE INDEX IF NOT EXISTS idx_${table(group)}_${col} ON ${table(group)} (clinicId, ${col})`);
        }
      }
    }).catch(e => {ready = undefined; throw e;});
    return ready;
  }
  async function all(group: string, cid: string) {
    return (await db.execute({sql:`SELECT * FROM ${table(group)} WHERE clinicId = ?`,args:[cid]})).rows;
  }
  async function meta(cid: string) {
    const r = await db.execute({sql:'SELECT * FROM finance_meta WHERE id = ?',args:[cid]});
    return r.rows[0] ? payload(r.rows[0]) : null;
  }
  async function putMeta(cid: string, value: any) {
    const exists = await meta(cid);
    if (exists) await db.execute({sql:'UPDATE finance_meta SET data = ? WHERE id = ?',args:[JSON.stringify(value),cid]});
    else await db.execute({sql:'INSERT INTO finance_meta (id,data) VALUES (?,?)',args:[cid,JSON.stringify(value)]});
  }
  function entries(group: string, state: any): [string,any][] {
    if (!Object.hasOwn(state,group)) return [];
    const value = state[group];
    if ((group==='receipts'||group==='events') ? !Array.isArray(value) : (!value || typeof value!=='object' || Array.isArray(value)))
      throw new Error('Invalid financial group: '+group);
    return (group==='receipts'||group==='events') ? value.map((v:any,i:number)=>[String(i),v]) : Object.entries(value);
  }
  async function insert(group: string, cid: string, entryKey: string, value: any, ordinal: number) {
    const id = key(cid,group,entryKey);
    const d = value && typeof value==='object' ? value : {};
    await db.execute({sql:`INSERT INTO ${table(group)} (id,clinicId,entryKey,ordinal,patientId,appointmentId,shiftId,collectionDate,originalReceiptId,data) VALUES (?,?,?,?,?,?,?,?,?,?)`,args:[id,cid,entryKey,ordinal,d.patientId??null,d.appointmentId??null,d.shiftId??null,d.collectionDate??d.date??null,d.originalReceiptId??null,JSON.stringify(value)]});
  }
  async function reconstruct(cid: string, m: any) {
    const result = clone(m.root);
    for (const group of groups) {
      if (!m.present.includes(group)) continue;
      const rows = await all(group,cid);
      rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal));
      if (group==='receipts'||group==='events') result[group]=rows.map(payload);
      else {
        result[group]={};
        for(const row of rows) Object.defineProperty(result[group],row.entryKey??row.entrykey,{value:payload(row),enumerable:true,writable:true,configurable:true});
      }
    }
    return result;
  }
  async function write(cid: string, state: any, partialRequests=false) {
    if (!state || typeof state!=='object' || Array.isArray(state)) throw new Error('Invalid financial state');
    const root=clone(state); for(const group of groups) delete root[group];
    for (const group of groups) {
      const existingRows=group==='requests'&&partialRequests ? (await Promise.all(Object.keys(state.requests||{}).map(entryKey=>db.execute({sql:'SELECT * FROM finance_requests WHERE id = ?',args:[key(cid,'requests',entryKey)]})))).flatMap(r=>r.rows) : await all(group,cid);
      const old=new Map<string,any>(existingRows.map((r:any)=>[r.entryKey??r.entrykey,r]));
      let ordinal=0;
      for(const [entryKey,value] of entries(group,state)) {
        const previous=old.get(entryKey);
        if(!previous || Number(previous.ordinal)!==ordinal || !isDeepStrictEqual(payload(previous),value)) {
          if(previous) await db.execute({sql:`DELETE FROM ${table(group)} WHERE id = ?`,args:[previous.id]});
          await insert(group,cid,entryKey,value,ordinal);
        }
        old.delete(entryKey); ordinal++;
      }
      for(const row of old.values()) await db.execute({sql:`DELETE FROM ${table(group)} WHERE id = ?`,args:[row.id]});
    }
    const previousMeta=await meta(cid);
    const m={...previousMeta,root,present:groups.filter(g=>Object.hasOwn(state,g)),version:2,verified:true,projectionReady:false};
    await putMeta(cid,m);
    return m;
  }
  async function migrate(cid: string) {
    await schema();
    // Callers hold the same clinic advisory transaction lock as money writes.
    const existing=await meta(cid); if(existing){if(!existing.verified)throw Error('Unverified financial migration');return existing;}
    const rows=(await db.execute({sql:'SELECT * FROM finance_state WHERE id = ?',args:[cid]})).rows;
    const original=rows.length ? payload(rows[0]) : {version:1,receipts:[],events:[],requests:{}};
    const m=await write(cid,original);
    const rebuilt=await reconstruct(cid,m);
    if(!isDeepStrictEqual(original,rebuilt)) throw new Error('Finance migration row verification failed');
    // Keep the source untouched as an archive, not a dual-write fallback.
    const sourceHash=crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex');
    await putMeta(cid,{...m,sourceHash,verifiedAt:new Date().toISOString()});
    console.log('[Finance migration] verified clinic '+cid+' row by row');
    return m;
  }
  async function projectionMeta(cid:string) {return meta(cid);}
  async function buildProjection(cid:string,collections:Record<string,any[]>,summary:any) {
    for(const [kind,list] of Object.entries(collections)) {
      if(!['receipts','events','expenses','appointments'].includes(kind))throw Error('Invalid projection kind');
      const previous=new Map<string,any>((await db.execute({sql:`SELECT * FROM finance_view_${kind} WHERE clinicId = ?`,args:[cid]})).rows.map((r:any)=>[r.id,r]));
      for(let ordinal=0;ordinal<list.length;ordinal++) {
        const d=list[ordinal],id=key(cid,kind,String(ordinal));const old=previous.get(id);previous.delete(id);
        if(old&&isDeepStrictEqual(payload(old),d))continue;
        if(old)await db.execute({sql:`DELETE FROM finance_view_${kind} WHERE id = ?`,args:[id]});
        await db.execute({sql:`INSERT INTO finance_view_${kind} (id,clinicId,ordinal,patientId,patientAlias,appointmentId,shiftId,patientPhone,patientName,date,data) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,args:[key(cid,kind,String(ordinal)),cid,ordinal,d.patientId??null,d.patient_id??null,d.appointmentId??null,d.shiftId??null,d.patientPhone??null,d.patientName??null,(kind==='events'?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.createdAt)):d.collectionDate??d.date??null),JSON.stringify(d)]});
      }
      for(const old of previous.values())await db.execute({sql:`DELETE FROM finance_view_${kind} WHERE id = ?`,args:[old.id]});
    }
    for(const [kind,list] of Object.entries(collections)) {
      const stored=(await db.execute({sql:`SELECT * FROM finance_view_${kind} WHERE clinicId = ?`,args:[cid]})).rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal)).map(payload);
      if(!isDeepStrictEqual(stored,list))throw Error('Financial projection row verification failed');
    }
    await putMeta(cid,{...await meta(cid),projectionReady:true,expenseSummary:summary});
  }
  async function selectProjection(cid:string,kind:string,filter:{from?:string,to?:string,patientId?:string,appointmentId?:string,shiftId?:string,patientPhone?:string,patientName?:string,date?:string,appointmentIds?:string[],includePatientId?:string}={}) {
    if(!['receipts','events','expenses','appointments'].includes(kind))throw Error('Invalid projection kind');
    let sql=`SELECT * FROM finance_view_${kind} WHERE clinicId = ?`;const args:any[]=[cid];
    for(const [field,op,value] of [['date','>=',filter.from],['date','<=',filter.to],['appointmentId','=',filter.appointmentId],['patientPhone','=',filter.patientPhone],['patientName','=',filter.patientName],['shiftId','=',filter.shiftId],['date','=',filter.date]]) if(value){sql+=` AND ${field} ${op} ?`;args.push(value);}
    if(filter.patientId){sql+=' AND (patientId = ? OR patientAlias = ?)';args.push(filter.patientId,filter.patientId);}
    if(filter.patientId&&!db.getIsPostgres()){const rows=await allProjectionRows();return rows.filter((r:any)=>r.patientId===filter.patientId||r.patient_id===filter.patientId);}
    if(filter.appointmentIds) {
      const matches:string[]=[];
      if(filter.appointmentIds.length){matches.push(`appointmentId IN (${filter.appointmentIds.map(()=>'?').join(',')})`);args.push(...filter.appointmentIds);}
      if(filter.includePatientId){matches.push('patientId = ?');args.push(filter.includePatientId);}
      if(!matches.length)return [];
      sql+=' AND ('+matches.join(' OR ')+')';
    }
    if(filter.appointmentIds&&!db.getIsPostgres()) {
      return (await allProjectionRows()).filter((r:any)=>filter.appointmentIds!.includes(r.appointmentId)||(filter.includePatientId&&r.patientId===filter.includePatientId));
    }
    async function allProjectionRows(){return (await db.execute({sql:`SELECT * FROM finance_view_${kind} WHERE clinicId = ?`,args:[cid]})).rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal)).map(payload);}
    const result=(await db.execute({sql,args})).rows;result.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal));return result.map(payload);
  }
  async function queryRows(group:string,cid:string,filters:Record<string,string>={}) {
    if(!groups.includes(group as any))throw Error('Invalid financial table');
    let sql=`SELECT * FROM ${table(group)} WHERE clinicId = ?`;const args:any[]=[cid];
    for(const [field,value] of Object.entries(filters)) {
      if(!['patientId','appointmentId','shiftId','collectionDate'].includes(field))throw Error('Invalid financial filter');
      sql+=` AND ${field} = ?`;args.push(value);
    }
    return (await db.execute({sql,args})).rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal)).map(payload);
  }
  async function loadCommand(cid:string,body:any) {
    const m=await migrate(cid);
    const state=await readLedger(cid);Object.assign(state,clone(m.root));
    const wanted=new Set<string>([String(body.requestId||''),String(body.targetRequestId||'')]);
    if(body.receiptId){const original=state.receipts.find((r:any)=>r.id===body.receiptId);if(original?.requestId)wanted.add(original.requestId);}
    for(const entryKey of wanted){if(!entryKey)continue;const rows=(await db.execute({sql:'SELECT * FROM finance_requests WHERE id = ?',args:[key(cid,'requests',entryKey)]})).rows;if(rows.length)Object.defineProperty(state.requests,entryKey,{value:payload(rows[0]),enumerable:true,writable:true,configurable:true});}
    return state;
  }
  async function saveCommand(cid:string,state:any){await write(cid,state,true);}
  async function readLedger(cid:string) {
    await migrate(cid);
    const state:any={receipts:[],events:[],requests:{},assignments:{}};
    for(const group of ['receipts','events','assignments']) {
      const rows=await all(group,cid);rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal));
      if(group==='assignments') for(const row of rows) Object.defineProperty(state.assignments,row.entryKey??row.entrykey,{value:payload(row),enumerable:true,writable:true,configurable:true});
      else state[group]=rows.map(payload);
    }
    return state;
  }
  async function load(cid:string) {await schema();return db.financeTransaction(cid,async()=>{const m=await migrate(cid);return reconstruct(cid,m);});}
  async function streamExport(cid:string, write:(chunk:string)=>Promise<void>, check:()=>void) {
    await schema();
    const m=await meta(cid);
    if(!m) {
      // Read a legacy value once, never repeatedly detoast/scan it via substring.
      check();checkExportMemory();
      if(db.getIsPostgres()) {
        const size=(await db.execute({sql:'SELECT octet_length(data) AS bytes FROM finance_state WHERE id = ?',args:[cid]})).rows[0]?.bytes;
        if(Number(size)>LEGACY_FINANCE_MAX_BYTES)throw Object.assign(new Error('Legacy finance exceeds export working-set limit'),{code:'EXPORT_LEGACY_TOO_LARGE'});
      }
      const rows=(await db.execute({sql:'SELECT data FROM finance_state WHERE id = ?',args:[cid]})).rows;
      const raw=rows[0]?.data;
      const text=typeof raw==='string'&&raw?raw:JSON.stringify(raw||{version:1,receipts:[],events:[],requests:{}});
      if(Buffer.byteLength(text)>LEGACY_FINANCE_MAX_BYTES)throw Object.assign(new Error('Legacy finance exceeds export working-set limit'),{code:'EXPORT_LEGACY_TOO_LARGE'});
      checkExportMemory();
      // Slice JS text without splitting a surrogate pair across stream writes.
      for(let offset=0;offset<text.length;){check();checkExportMemory();let end=Math.min(text.length,offset+EXPORT_WRITE_BYTES/2);const code=text.charCodeAt(end-1);if(end<text.length&&code>=0xD800&&code<=0xDBFF)end--;await write(text.slice(offset,end));offset=end;}
      return;
    }
    if(!m.verified)throw Error('Unverified financial migration');
    await write('{');let first=true;
    for(const [k,v] of Object.entries(m.root||{})){await write((first?'':',')+JSON.stringify(k)+':'+JSON.stringify(v));first=false;}
    for(const group of groups) {
      if(!m.present.includes(group))continue;
      const array=group==='receipts'||group==='events';
      await write((first?'':',')+JSON.stringify(group)+':'+(array?'[':'{'));first=false;
      let emitted=false,last:any=null;
      while(true){
        check();
        checkExportMemory();
        const rows=(await db.execute({sql:`SELECT * FROM ${table(group)} WHERE clinicId = ?${last?' AND (ordinal > ? OR (ordinal = ? AND id > ?))':''} ORDER BY ordinal ASC, id ASC LIMIT 5000`,args:last?[cid,last.ordinal,last.ordinal,last.id]:[cid]})).rows;
        // The development JSON emulator does not sort arbitrary SQL columns.
        if(!db.getIsPostgres())rows.sort((a:any,b:any)=>Number(a.ordinal)-Number(b.ordinal));
        for(const row of rows){check();await write((emitted?',':'')+(array?'':JSON.stringify(row.entryKey??row.entrykey)+':')+JSON.stringify(payload(row)));emitted=true;}
        if(rows.length<5000)break;last=rows[rows.length-1];
      }
      await write(array?']':'}');
    }
    await write('}');
  }
  async function save(cid:string,state:any) {await schema();return db.financeTransaction(cid,async()=>{await migrate(cid);await write(cid,state);});}
  async function remove(cid:string) {
    for(const group of groups) await db.execute({sql:`DELETE FROM ${table(group)} WHERE clinicId = ?`,args:[cid]});
    for(const kind of ['receipts','events','expenses','appointments'])await db.execute({sql:`DELETE FROM finance_view_${kind} WHERE clinicId = ?`,args:[cid]});
    await db.execute({sql:'DELETE FROM finance_meta WHERE id = ?',args:[cid]});
  }
  return {schema,load,streamExport,save,migrate,remove,readLedger,queryRows,projectionMeta,buildProjection,selectProjection,loadCommand,saveCommand};
}
