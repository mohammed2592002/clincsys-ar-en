import {sameValue, SERVER_METADATA} from './utils/documentComparison';
import {commandMessage} from './utils/commandMessages';
import {listCommands,saveCommand,removeCommand,enqueueCommand,settleConflict,commandOwner,commandFingerprint, type DurableCommand} from './utils/commandQueue';
import {
  saveLocalDoc,
  getLocalDoc,
  removeLocalDoc,
  getLocalDocsForPath,
  addToSyncQueue,
  getSyncQueue,
  removeFromSyncQueue,
  filterAndSortLocalDocs,
  isDocPendingInSyncQueue,
  normalizeDocPath,
  saveOfflineMedia,
  getOfflineMedia,
  removeOfflineMedia,
  getAllPendingOfflineMedia
} from './utils/offlineDb';
import { safeStorage } from './utils/storage';
import { uploadFileToR2, dataUrlToBlob } from './utils/r2Upload';

// ==================== AUTH TOKEN HANDLING ====================
// The server issues a signed session token at login; every API request carries it.
const AUTH_TOKEN_KEY = 'dental_auth_token';

export function getAuthToken(): string {
  try {
    return safeStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setAuthToken(token: string) {
  try {
    if (token) {
      safeStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      safeStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch (e) {}
}

export function clearAuthToken() {
  setAuthToken('');
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return {'Accept-Language':safeStorage.getItem('i18nextLng')||'ar',...(token?{Authorization:`Bearer ${token}`}:{})};
}

function handleAuthExpiry() {
  try {
    safeStorage.removeItem(AUTH_TOKEN_KEY);
    safeStorage.removeItem('dental_saas_session');
  } catch (e) {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clinic-auth-expired'));
  }
}
// ================== END AUTH TOKEN HANDLING ==================

export const app = { name: '[MockApp]' };

const smartDocsCache = new Map<string, any>();
const smartDocCache = new Map<string, any>();
const invalidatedTables = new Set<string>();

export function clearQueryCache() {
  smartDocsCache.clear();
  smartDocCache.clear();
}

export function clearTableCache(tableName: string) {
  if (!tableName) return;
  const lowerTable = tableName.toLowerCase();
  invalidatedTables.add(lowerTable);

  for (const key of smartDocsCache.keys()) {
    if (key.toLowerCase().includes(lowerTable)) {
      smartDocsCache.delete(key);
    }
  }

  for (const key of smartDocCache.keys()) {
    if (key.toLowerCase().includes(lowerTable)) {
      smartDocCache.delete(key);
    }
  }
}

function getTableNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'clinics' && parts.length >= 3) {
    if (parts[2] === 'patients' && parts.length >= 5) {
      return parts[4];
    }
    return parts[2];
  }
  return parts[0] || '';
}

let syncChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    syncChannel = new BroadcastChannel('clinic_saas_sync_channel');
    syncChannel.onmessage = (event) => {
      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: event.data }));
    };
  } catch (e) {
    console.warn('BroadcastChannel initialization error:', e);
  }
}

export function notifyLocalSync(path: string, action: string, id?: string) {
  const table = getTableNameFromPath(path);
  clearTableCache(table);
  if (typeof window !== 'undefined') {
    console.log(`[dbClient] dispatching local clinic-sync for ${table}:${action}`);
    const detail = { table, action, id, path };
    window.dispatchEvent(new CustomEvent('clinic-sync', { detail }));
    if (syncChannel) {
      try {
        syncChannel.postMessage(detail);
      } catch (e) {
        console.warn('syncChannel postMessage failed:', e);
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('clinic-sync', async (e: any) => {
    const detail = e.detail || {};
    const table = detail.table;
    const action = detail.action;
    const docId = detail.id || detail.recordId || detail.payload?.id;
    const clinicId = detail.clinicId;

    if (table) {
      console.log(`[dbClient] invalidating cache for table: ${table}`);
      clearTableCache(table);
    } else {
      console.log(`[dbClient] invalidating entire cache`);
      clearQueryCache();
    }

    if ((action === 'delete' || action === 'deleteDoc') && docId) {
      let path = detail.path;
      if (!path && clinicId && table) {
        path = `clinics/${clinicId}/${table}`;
      } else if (!path && table) {
        // Find matching local docs with that table path
        const localDocs = await getLocalDocsForPath(`clinics/${table}`);
        path = localDocs.length > 0 ? `clinics/${table}` : '';
      }

      if (path) {
        console.log(`[dbClient] Sync event deleting local doc: ${path}:${docId}`);
        await removeLocalDoc(path, docId).catch(() => {});
        if (table === 'patients') {
          await removeLocalDoc(`${path}/${docId}/records`, docId).catch(() => {});
          await removeLocalDoc(`${path}/${docId}/appointments`, docId).catch(() => {});
        }
      } else {
        // Fallback: purge by docId across safeStorage and IndexedDB key
        safeStorage.removeItem(`offline_doc_${docId}`);
      }
    } else if ((action === 'add' || action === 'set' || action === 'update') && detail.payload && detail.payload.id) {
      let path = detail.path;
      if (!path && clinicId && table) {
        path = `clinics/${clinicId}/${table}`;
      }
      if (path) {
        await saveLocalDoc(path, detail.payload.id, detail.payload).catch(() => {});
      }
    }
  });
}

function getApiUrl(endpoint: string): string {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${cleanOrigin}${cleanEndpoint}`;
  }
  return endpoint;
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 2, initialDelay = 300, timeoutMs = 12000): Promise<Response> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('OFFLINE_NETWORK');
  }
  const fullUrl = getApiUrl(url);
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let callerAbortListener: (() => void) | null = null;

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new DOMException('Aborted', 'AbortError');
      }
      callerAbortListener = () => controller.abort();
      options.signal.addEventListener('abort', callerAbortListener);
    }

    try {
      const res = await fetch(fullUrl, {
        ...options,
        headers: { ...authHeaders(), ...(options.headers || {}) },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (options.signal && callerAbortListener) {
        options.signal.removeEventListener('abort', callerAbortListener);
      }
      if (res.status === 401 && typeof fullUrl === 'string' && fullUrl.includes('/api/db')) {
        // Session expired or logged out elsewhere: force re-login
        handleAuthExpiry();
      }
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      if (options.signal && callerAbortListener) {
        options.signal.removeEventListener('abort', callerAbortListener);
      }
      if (options.signal?.aborted || err.name === 'AbortError') {
        throw err;
      }
      if (i === retries - 1 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        throw err;
      }
      const currentDelay = initialDelay * Math.pow(1.5, i);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
  throw new Error('Fetch failed after retries');
}

export class MockDb {
  constructor() {}
}
export const db = new MockDb();

export class MockAuth {
  currentUser: any = null;
  onStateChangedListeners: any[] = [];
  constructor() {}
}
export const auth = new MockAuth();

export class MockStorage {
  constructor() {}
}
export const storage = new MockStorage();

export const analytics = null;

export class MockCollectionReference {
  constructor(public path: string) {}
}

export class MockDocumentReference {
  constructor(public path: string, public id: string) {}
}

export class MockQuery {
  constructor(public ref: MockCollectionReference, public constraints: any[] = []) {}
}

function joinPath(...segments: any[]): string {
  return segments
    .filter((s) => typeof s === 'string' && s.length > 0)
    .join('/');
}

export function collection(db_or_ref: any, ...pathSegments: string[]): MockCollectionReference {
  let basePath = '';
  if (db_or_ref instanceof MockCollectionReference) {
    basePath = db_or_ref.path;
  }
  const joined = joinPath(basePath, ...pathSegments);
  return new MockCollectionReference(joined);
}

export function doc(db_or_ref_or_col: any, ...pathSegments: string[]): MockDocumentReference {
  let basePath = '';
  if (db_or_ref_or_col instanceof MockCollectionReference) {
    basePath = db_or_ref_or_col.path;
  } else if (db_or_ref_or_col instanceof MockDocumentReference) {
    basePath = db_or_ref_or_col.path;
  }
  const segments =
    pathSegments.length === 0 && db_or_ref_or_col instanceof MockCollectionReference
      ? [generateAutoId()]
      : pathSegments;
  const joined = joinPath(basePath, ...segments);
  const parts = joined.split('/').filter(Boolean);
  const id = parts[parts.length - 1] || '';
  return new MockDocumentReference(joined, id);
}

function generateAutoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'doc_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

export function query(ref: MockCollectionReference, ...constraints: any[]): MockQuery {
  return new MockQuery(ref, constraints);
}

export function where(field: string, op: string, value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(n: number) {
  return { type: 'limit', limit: n };
}

export function startAfter(docSnap: any) {
  if (!docSnap) return { type: 'startAfter', docSnap: null };
  let rawData = null;
  if (typeof docSnap.data === 'function') {
    rawData = docSnap.data();
  } else if (docSnap.data) {
    rawData = docSnap.data;
  }
  return {
    type: 'startAfter',
    docSnap: {
      id: docSnap.id,
      data: rawData
    }
  };
}

export async function getDocs(q: any, forceRefresh = false): Promise<any> {
  const path = q instanceof MockQuery ? q.ref.path : q.path;
  const constraints = q instanceof MockQuery ? q.constraints : [];
  const table = getTableNameFromPath(path);
  const isInvalidated = table && invalidatedTables.has(table.toLowerCase());

  // Fast Path: check local offline storage first if available, unless forceRefresh or table was invalidated
  if (!forceRefresh && !isInvalidated) {
    try {
      const localDocs = await getLocalDocsForPath(path);
      if (Array.isArray(localDocs) && localDocs.length > 0) {
        const filteredDocs = filterAndSortLocalDocs(localDocs, constraints);
        const hasPagination = Array.isArray(constraints) && constraints.some((c: any) => c.type === 'startAfter' || c.type === 'startAt');
        const hasLimit = Array.isArray(constraints) && constraints.some((c: any) => c.type === 'limit');

        // Only use local cache for limited queries or when cache is valid
        if (hasLimit && (!hasPagination || filteredDocs.length > 0)) {
          const docSnaps = filteredDocs.map((docData: any) => ({
            id: docData.id,
            data: () => docData,
            exists: () => true
          }));

          // Background revalidation fetch to keep local storage synced with server
          (async () => {
            try {
              const res = await fetchWithRetry('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getDocs', path, constraints })
              }, 1, 300, 8000);
              if (res.ok) {
                const dataList = await res.json();
                if (Array.isArray(dataList)) {
                  const serverIds = new Set(dataList.map((d: any) => d?.id).filter(Boolean));
                  for (const d of dataList) {
                    if (d && d.id) {
                      const isPending = await isDocPendingInSyncQueue(path, d.id);
                      if (!isPending) {
                        await saveLocalDoc(path, d.id, d).catch(() => {});
                      }
                    }
                  }
                  const isFullFetch = !Array.isArray(constraints) || !constraints.some((c: any) => c.type === 'limit' || c.type === 'startAfter' || c.type === 'startAt' || c.type === 'where');
                  let removedAny = false;
                  if (isFullFetch) {
                    for (const localDoc of localDocs) {
                      if (localDoc && localDoc.id && !serverIds.has(localDoc.id)) {
                        const isPending = await isDocPendingInSyncQueue(path, localDoc.id);
                        if (!isPending) {
                          await removeLocalDoc(path, localDoc.id).catch(() => {});
                          removedAny = true;
                        }
                      }
                    }
                  }
                  if (removedAny) {
                    notifyLocalSync(path, 'revalidated');
                  }
                }
              }
            } catch (e) {
              // Silently handled background sync
            }
          })();

          return {
            empty: docSnaps.length === 0,
            docs: docSnaps,
            forEach(callback: any) {
              docSnaps.forEach(callback);
            },
            size: docSnaps.length
          };
        }
      }
    } catch (e) {
      // Fallback to direct network fetch if local read fails
    }
  }

  if (table) {
    invalidatedTables.delete(table.toLowerCase());
  }

  try {
    const res = await fetchWithRetry('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getDocs', path, constraints })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const dataList = await res.json();
    
    // Save returned docs into local storage and clean up deleted ones
    if (Array.isArray(dataList)) {
      const serverIds = new Set(dataList.map((d: any) => d?.id).filter(Boolean));
      dataList.forEach((d) => {
        if (d && d.id) {
          saveLocalDoc(path, d.id, d).catch(() => {});
        }
      });

      // Asynchronously purge local docs that were deleted on server ONLY on full collection fetch
      const isFullFetch = !Array.isArray(constraints) || !constraints.some((c: any) => c.type === 'limit' || c.type === 'startAfter' || c.type === 'startAt' || c.type === 'where');
      if (isFullFetch) {
        getLocalDocsForPath(path).then((existingLocalDocs) => {
          if (Array.isArray(existingLocalDocs)) {
            existingLocalDocs.forEach((localDoc) => {
              if (localDoc && localDoc.id && !serverIds.has(localDoc.id)) {
                isDocPendingInSyncQueue(path, localDoc.id).then((isPending) => {
                  if (!isPending) {
                    removeLocalDoc(path, localDoc.id).catch(() => {});
                  }
                });
              }
            });
          }
        }).catch(() => {});
      }
    }

    const docSnaps = dataList.map((docData: any) => ({
      id: docData.id,
      data: () => docData,
      exists: () => true
    }));
    return {
      empty: docSnaps.length === 0,
      docs: docSnaps,
      forEach(callback: any) {
        docSnaps.forEach(callback);
      },
      size: docSnaps.length
    };
  } catch (err) {
    const localDocs = await getLocalDocsForPath(path);
    const filteredDocs = filterAndSortLocalDocs(localDocs, constraints);
    const docSnaps = filteredDocs.map((docData: any) => ({
      id: docData.id,
      data: () => docData,
      exists: () => true
    }));
    return {
      fromCache: true,
      empty: docSnaps.length === 0,
      docs: docSnaps,
      forEach(callback: any) {
        docSnaps.forEach(callback);
      },
      size: docSnaps.length
    };
  }
}

export async function getAppointmentsCounts(clinicId: string): Promise<Record<string, number>> {
  const path = `clinics/${clinicId}/appointments`;
  try {
    const localAppointments = await getLocalDocsForPath(path);
    if (Array.isArray(localAppointments) && localAppointments.length > 0) {
      // Revalidate in background
      (async () => {
        try {
          const res = await fetchWithRetry('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getAppointmentsCounts', path })
          }, 1, 300, 8000);
          if (res.ok) {
            notifyLocalSync(path, 'revalidated');
          }
        } catch (e) {}
      })();

      const counts: Record<string, number> = {};
      localAppointments.forEach((app) => {
        const date = app.appointmentDate || app.date;
        if (date) {
          counts[date] = (counts[date] || 0) + 1;
        }
      });
      return counts;
    }
  } catch (e) {}

  try {
    const res = await fetchWithRetry('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getAppointmentsCounts', path })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return await res.json();
  } catch (err) {
    const localAppointments = await getLocalDocsForPath(path);
    const counts: Record<string, number> = {};
    localAppointments.forEach((app) => {
      const date = app.appointmentDate || app.date;
      if (date) {
        counts[date] = (counts[date] || 0) + 1;
      }
    });
    return counts;
  }
}

export async function getDoc(docRef: MockDocumentReference, forceRefresh = false): Promise<any> {
  const path = docRef.path;
  const id = docRef.id;

  if (!forceRefresh) {
    try {
      const localData = await getLocalDoc(path, id);
      if (localData !== null && localData !== undefined) {
        // Revalidate in background
        (async () => {
          try {
            const res = await fetchWithRetry('/api/db', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'getDoc', path, id })
            }, 1, 300, 8000);
            if (res.ok) {
              const docData = await res.json();
              if (docData) {
                const isPending = await isDocPendingInSyncQueue(path, id);
                if (!isPending) {
                  await saveLocalDoc(path, id, docData).catch(() => {});
                }
              }
            }
          } catch (e) {}
        })();

        return {
          id,
          exists: () => true,
          data: () => localData
        };
      }
    } catch (e) {}
  }

  try {
    const res = await fetchWithRetry('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getDoc', path, id })
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const docData = await res.json();
    if (docData && !(await isDocPendingInSyncQueue(path,id))) {
      await saveLocalDoc(path, id, docData);
    }
    return {
      id,
      exists: () => docData !== null,
      data: () => docData
    };
  } catch (err) {
    const localData = await getLocalDoc(path, id);
    return {
      id,
      exists: () => localData !== null,
      data: () => localData
    };
  }
}

const commandError=(message:string)=>new Error(commandMessage(message,(safeStorage.getItem('i18nextLng')||'ar').startsWith('en')));
// The queue persists commands, never a replacement paid-balance snapshot.
let commandFlush:Promise<void>|null=null;
const activeSends = new Map<string, Promise<any>>();
function sendDurable(command:DurableCommand):Promise<any>{
 const existing=activeSends.get(command.id);if(existing)return existing;
 const work=sendDurableOnce(command).finally(()=>activeSends.delete(command.id));
 activeSends.set(command.id,work);return work;
}
async function sendDurableOnce(command:DurableCommand){
 if(command.owner!==commandOwner(getAuthToken()))throw commandError('الطلب يخص حسابًا آخر');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch('/api/finance',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({clinicId:command.clinicId,...command.body,requestId:command.id}),signal:controller.signal});
  const result=await response.json();
  if(!response.ok){if(response.status>=400&&response.status<500){command.status='conflict';command.error=result.message||'يلزم مراجعة الطلب';command.conflict=result.conflict;await saveCommand(command);}throw commandError(result.message||'لم يؤكد السيرفر الطلب');}
  if(result.appointment)await saveLocalDoc('clinics/'+command.clinicId+'/appointments',result.appointment.id,result.appointment);
  if(command.localPath&&command.localId){if(command.body.action==='delete')await removeLocalDoc(command.localPath,command.localId);else await saveLocalDoc(command.localPath,command.localId,{...(command.body.table==='clinics'?await getLocalDoc(command.localPath,command.localId):{}),...result,_syncStatus:'confirmed'});}
  await removeCommand(command.id);if(command.localPath&&command.localId){for(const next of await listCommands()){if(next.localPath===command.localPath&&next.localId===command.localId&&next.body.action==='write'&&next.body.optimistic){const cached=await getLocalDoc(command.localPath,command.localId);await saveLocalDoc(command.localPath,command.localId,{...cached,...next.body.data,_syncStatus:next.status==='conflict'?'conflict':'pending'});}}}clearQueryCache();window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{action:'command-confirmed'}}));syncChannel?.postMessage({action:'command-confirmed'});return result;
 }finally{clearTimeout(timer);}
}
function commandsDependOn(current:DurableCommand,earlier:DurableCommand){
 if(current.clinicId!==earlier.clinicId)return false;
 if(current.body.table===earlier.body.table&&current.body.id&&current.body.id===earlier.body.id)return true;
 if(current.body.appointmentId&&current.body.appointmentId===earlier.body.appointmentId)return true;
 if(earlier.body.id&&(current.body.appointmentId===earlier.body.id||current.body.data?.appointmentId===earlier.body.id))return true;
 if(earlier.body.create&&earlier.body.id&&current.body.data?.patientId===earlier.body.id)return true;
 return earlier.body.table==='clinics'&&current.financial;
}
export async function flushDurableCommands(){if(commandFlush)return commandFlush;if(!navigator.onLine)return;
 commandFlush=(async()=>{const owner=commandOwner(getAuthToken()),blocked:DurableCommand[]=[];for(const command of await listCommands()){if(command.owner!==owner)continue;if(command.status==='conflict'||blocked.some(c=>commandsDependOn(command,c))){blocked.push(command);continue;}try{await sendDurable(command);}catch{if((command as DurableCommand).status==='conflict'){blocked.push(command);continue;}break;}}})().finally(()=>{commandFlush=null;});return commandFlush;
}
export async function inspectFinancialConflict(id:string){const command=(await getPendingCommands()).find(c=>c.id===id);if(!command||!command.financial||command.status!=='conflict')throw commandError('اختر طلبًا ماليًا متعارضًا');const response=await fetch('/api/finance',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({clinicId:command.clinicId,action:'inspect_pending',targetRequestId:command.id,appointmentId:command.body.appointmentId})});if(!response.ok)throw commandError((await response.json()).message||'تعذر المراجعة المالية');return {command,...await response.json()};}
export async function reconcileFinancialConflict(id:string,reason:string){const review=await inspectFinancialConflict(id);const response=await fetch('/api/finance',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({clinicId:review.command.clinicId,action:'review_pending',targetRequestId:id,reason,requestId:crypto.randomUUID()})});const result=await response.json();if(!response.ok)throw commandError(result.message||'لم يؤكد السيرفر المراجعة');await settleConflict({...review.command,status:'resolved',resolution:result.reviewState,resolvedAt:new Date().toISOString()});if(result.originalResult?.appointment)await saveLocalDoc('clinics/'+review.command.clinicId+'/appointments',result.originalResult.appointment.id,result.originalResult.appointment);clearQueryCache();window.dispatchEvent(new CustomEvent('clinic-sync',{detail:{action:'financial-reviewed'}}));return result;}
export async function reviewDurableCommand(id:string){const c=(await getPendingCommands()).find(c=>c.id===id);if(!c||c.status!=='conflict'||!c.localPath||!c.localId||c.financial)throw commandError('هذه الحركة تحتاج مراجعة مالية مع المدير، دون تعديل تلقائي');const response=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({action:'getDoc',path:c.localPath,id:c.localId})});if(!response.ok)throw commandError('تعذر تحميل النسخة الحالية من السيرفر');return {command:c,current:await response.json()};}
export async function resolveDurableCommand(id:string,choice:'server'|'local',reviewedCurrent:any){
 const {command,current}=await reviewDurableCommand(id);if(!current)throw commandError('السجل غير موجود على السيرفر، يلزم مراجعة المدير');
 if(!sameValue(current,reviewedCurrent))throw commandError('تغيرت نسخة السيرفر بعد عرضها، أعد المراجعة');
 let replacement:DurableCommand|undefined;
 if(choice==='local'){
  if(command.body.create||command.body.action!=='write')throw commandError('لا يمكن استبدال سجل بهذه الحركة');
  const base:any={};for(const k of Object.keys(command.body.data||{}))if(!SERVER_METADATA.has(k))base[k]=current[k]??null;
  const body={...command.body,base};replacement={...command,id:crypto.randomUUID(),body,fingerprint:commandFingerprint(command.clinicId,body),status:'pending',error:undefined,createdAt:new Date().toISOString()};
 }
 if(command.owner!==commandOwner(getAuthToken()))throw commandError('تغير الحساب، أعد فتح التنبيهات');
 await settleConflict({...command,status:'resolved',resolution:choice,resolvedAt:new Date().toISOString()},replacement);
 if(choice==='server'&&command.localPath&&command.localId)await saveLocalDoc(command.localPath,command.localId,{...current,_syncStatus:'confirmed'});
 clearQueryCache();notifyLocalSync(command.localPath||'','conflict-reviewed',command.localId);await flushDurableCommands();
}
export async function exportCommandHistory(){const owner=commandOwner(getAuthToken());return (await listCommands(true)).filter(c=>c.owner===owner);}
export function pendingMoneyAmount(c:DurableCommand){if(['collect','refund'].includes(c.body.action))return Number(c.body.amount||0);if(c.body.pendingMoneyAmount!==undefined)return Number(c.body.pendingMoneyAmount);if(c.body.table==='expenses')return Number(c.body.data?.amount||0);return 0;}
export async function getPendingCommands(){const owner=commandOwner(getAuthToken());return (await listCommands()).filter(c=>c.owner===owner||(owner.startsWith('manager:')&&c.clinicId===owner.split(':')[1]));}
export async function financeCommand(clinicId:string,body:any):Promise<any>{
 if(body.action==='read'){try{const response=await fetch('/api/finance',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({clinicId,...body})});if(!response.ok){const denied:any=commandError((await response.json()).message||'تعذر تحميل السجل');denied.authoritative=true;throw denied;}const result=await response.json();await saveLocalDoc('finance-ledger',commandOwner(getAuthToken())+':'+clinicId,result);return result;}catch(e:any){if(e.authoritative)throw e;const cached=await getLocalDoc('finance-ledger',commandOwner(getAuthToken())+':'+clinicId);if(cached)return {...cached,fromCache:true};throw e;}}
 const owner=commandOwner(getAuthToken());if(!owner)throw commandError('يلزم تسجيل الدخول قبل تسجيل طلب');
 if(body.action==='close'){const unresolved=(await getPendingCommands()).some(c=>c.financial&&c.body.action!=='close'&&(!c.body.expectedShiftId||c.body.expectedShiftId===body.shiftId));if(unresolved)throw commandError('توجد حركات مالية معلقة، راجع تنبيهات الإعدادات قبل إقفال الوردية');}
 const fingerprint=commandFingerprint(clinicId,body);let command=(await listCommands()).find(c=>c.owner===owner&&c.fingerprint===fingerprint);
 if(command?.status==='conflict')throw commandError('طلب محفوظ للمراجعة: '+command.error);
 if(!command){const shifts=await getLocalDocsForPath('clinics/'+clinicId+'/shifts');const activeShifts=shifts.filter(s=>s.status==='open');if((['collect','points','refund','discount'].includes(body.action)||body.table==='expenses'||(body.table==='lab_orders'&&Number(body.data?.paidAmount)>0)))body={...body,expectedShiftId:activeShifts.length===1?activeShifts[0].id:(!navigator.onLine?'unverified':undefined)};command={id:crypto.randomUUID(),owner,clinicId,body:{...body,clientOccurredAt:new Date().toISOString(),queuedBy:owner},fingerprint,createdAt:new Date().toISOString(),status:'pending',financial:!body.optimistic,localPath:body.localPath,localId:body.id};const clinic=await getLocalDoc('clinics',clinicId);let identity:any={};try{identity=JSON.parse(atob(getAuthToken().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{}command.actorName=identity.staffName||clinic?.doctorName||clinic?.name||(owner.startsWith('manager:')?'مدير العيادة':'حساب العيادة');command.actorRole=identity.staffRole||(owner.startsWith('manager:')?'المدير':'موظف');const entity=body.localPath&&body.id?await getLocalDoc(body.localPath,body.id):body.appointmentId?await getLocalDoc('clinics/'+clinicId+'/appointments',body.appointmentId):null;const patientId=body.data?.patientId||entity?.patientId;const patient=patientId?await getLocalDoc('clinics/'+clinicId+'/patients',patientId):null;command.entityName=body.data?.patientName||body.data?.name||entity?.patientName||entity?.name||patient?.name||body.data?.title||entity?.title;command=await enqueueCommand(command);}
 if(body.optimistic&&body.localPath&&command.localId){const old=await getLocalDoc(body.localPath,command.localId);await saveLocalDoc(body.localPath,command.localId,{...old,...body.data,id:command.localId,_syncStatus:'pending'});notifyLocalSync(body.localPath,'pending',command.localId);}
 if(navigator.onLine){try{const earlier=(await listCommands()).filter(c=>c.owner===owner&&(c.sequence&&command.sequence?c.sequence<command.sequence:c.createdAt<command.createdAt));for(const c of earlier){if(c.status==='conflict'){if(commandsDependOn(command,c))throw commandError('طلب مرتبط يحتاج مراجعة');continue;}try{await sendDurable(c);}catch(e){if((c as DurableCommand).status==='conflict'&&!commandsDependOn(command,c))continue;throw e;}}return await sendDurable(command);}catch(e:any){if(command.status==='conflict')throw e;}}
 if(body.optimistic){return {id:command.localId,pending:true,_syncStatus:'pending'};}
 throw commandError('محفوظ على الجهاز كطلب غير مؤكد. ستتم المزامنة عند رجوع الاتصال، لا تسجله مرة ثانية.');
}
const clinicSettingsKeys=new Set(['name','nameAr','nameEn','logoUrl','doctorName','doctorNameEn','doctorPhone','additionalPhones','doctorSpecialtyAr','doctorSpecialtyEn','clinicHours','address','prescriptionStyle','prescriptionLayout','customPrescriptionPadConfig','consultationPrice','bookingSystemMode','questionnaireQuestions','customDentalServices','orthodonticCatalogVersion','dentalServiceCategories','paymentMethods','dentalChartStyleSettings','autoBackupEnabled','autoBackupFormat','loyaltyProgramEnabled','loyaltyEarnEgpThreshold','loyaltyEarnPoints','loyaltyRedeemPointsThreshold','loyaltyRedeemDiscountEgp','loyaltyMinRedeemPoints','updatedAt']);
async function clinicSettingsWrite(path:string,id:string,data:any){
 if(Object.keys(data||{}).every(k=>clinicSettingsKeys.has(k))){const old=await getLocalDoc(path,id),base:any={};if(old)for(const k of Object.keys(data))if(!SERVER_METADATA.has(k))base[k]=old[k]??null;return financeCommand(id,{action:'write',table:'clinics',id,data,base:old?base:undefined,optimistic:true,localPath:path});}
 // Credentials, staff access and subscription changes require a live server. Never persist them in the command queue.
 if(!navigator.onLine)throw commandError('تغيير بيانات الدخول والصلاحيات أو الاشتراك يحتاج اتصال بالسيرفر');
 const response=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({action:'updateDoc',path,id,data})});if(!response.ok)throw commandError('لم يؤكد السيرفر تعديل الإعدادات');
 await saveLocalDoc(path,id,await response.json());return {id};
}
function protectedPath(path:string){return /^clinics\/[^/]+\/(patients\/[^/]+\/)?(appointments|shifts|expenses|lab_orders|patients|records|prescriptions|xrays|teeth|inventory|custom_medications|custom_categories|laboratories|lab_work_types|billing|closings)(\/[^/]+)?$/.test(path);}
async function confirmedWrite(action:string,path:string,id:string,data?:any,options?:any){
 const parts=path.split('/');if(parts[2]==='patients'&&parts.length>=5){data={...data,patientId:parts[3]};parts[2]=parts[4];}
 const old=await getLocalDoc(path,id);const table=parts[2];
 const financial=action==='deleteDoc'||['expenses','shifts','billing','closings'].includes(table)||(table==='lab_orders'&&Number(data?.paidAmount||0)!==Number(old?.paidAmount||0))||(table==='appointments'&&(data?.status==='cancelled'||(data?.price!==undefined&&old?.price!==undefined&&Number(data.price)!==Number(old.price))));
 const patch={...data};delete patch._syncStatus;delete patch._fieldEdits;
 if(table==='appointments'&&old){for(const k of ['paidAmount','remainingAmount','invoiceStatus','payments'])delete patch[k];}
 const base:any={};if(old)for(const k of Object.keys(patch))if(!SERVER_METADATA.has(k))base[k]=old[k]===undefined?null:old[k];
 const pendingMoneyAmount=table==='lab_orders'?Math.max(0,Number(data?.paidAmount||0)-Number(old?.paidAmount||0)):table==='expenses'?Number(data?.amount||0):0;
 return financeCommand(parts[1],{pendingMoneyAmount,action:action==='deleteDoc'?'delete':'write',table,id,data:patch,options,base:old?base:undefined,create:action==='addDoc',optimistic:!financial,localPath:path});
}
if(typeof window!=='undefined'){window.addEventListener('online',()=>{flushDurableCommands().catch(console.error);});setInterval(()=>{flushDurableCommands().catch(console.error);},10000);}

export async function addDoc(collectionRef: MockCollectionReference, data: any): Promise<any> {
  clearQueryCache();
  const path = collectionRef.path;
  const id = generateAutoId();
  const docData = { ...data, id };
  if (protectedPath(path)) return confirmedWrite('addDoc',path,id,docData);

  // Save to local offline DB immediately for zero latency / offline execution
  await saveLocalDoc(path, id, docData);
  notifyLocalSync(path, 'add', id);

  // Asynchronously push to server without blocking UI
  (async () => {
    try {
      const res = await fetchWithRetry('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addDoc', path, data: docData })
      }, 2, 300, 10000);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const result = await res.json();
      const serverId = result.id || id;
      if (serverId !== id) {
        const currentLocal = await getLocalDoc(path, id);
        if (currentLocal) {
          await removeLocalDoc(path, id);
          await saveLocalDoc(path, serverId, { ...currentLocal, id: serverId });
          notifyLocalSync(path, 'add', serverId);
        }
      }
    } catch (err) {
      console.log('[Offline Mode] addDoc queued for background sync:', path, id);
      await addToSyncQueue({ action: 'addDoc', path, docId: id, data: docData });
    }
  })();

  return { id };
}

export async function setDoc(docRef: MockDocumentReference, data: any, options?: { merge?: boolean }): Promise<any> {
  clearQueryCache();
  const path = docRef.path;
  const id = docRef.id;
  const { collectionPath } = normalizeDocPath(path, id);
  if(path==='clinics'||path==='clinics/'+id)return clinicSettingsWrite(path,id,data);
  if (protectedPath(path)) return confirmedWrite('setDoc',path,id,data,options);

  if (collectionPath === 'system_settings') {
    // Global settings must be confirmed before the admin sees a success message.
    if (!navigator.onLine) throw commandError('يلزم الاتصال لحفظ إعدادات النظام');
    const response = await fetchWithRetry('/api/db', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action:'setDoc', path, id, data, options})
    });
    if (!response.ok) throw commandError('لم يؤكد السيرفر حفظ إعدادات النظام');
    const saved = await response.json();
    await saveLocalDoc(path, id, {...data, ...saved, id});
    notifyLocalSync(path, 'set', id);
    return {id};
  }

  let finalData = { ...data, id };
  if (options?.merge) {
    const existing = await getLocalDoc(path, id);
    if (existing) {
      finalData = { ...existing, ...data, id };
    }
  }

  await saveLocalDoc(path, id, finalData);
  notifyLocalSync(collectionPath, 'set', id);

  // Asynchronously push to server without blocking UI
  (async () => {
    try {
      const res = await fetchWithRetry('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setDoc', path, id, data: finalData, options })
      }, 2, 300, 10000);
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (err) {
      console.log('[Offline Mode] setDoc queued for background sync:', path, id);
      await addToSyncQueue({ action: 'setDoc', path: collectionPath, docId: id, data: finalData, options });
    }
  })();

  return { id };
}

export async function updateDoc(docRef: MockDocumentReference, data: any): Promise<any> {
  clearQueryCache();
  const path = docRef.path;
  const id = docRef.id;
  const { collectionPath } = normalizeDocPath(path, id);
  if(path==='clinics'||path==='clinics/'+id)return clinicSettingsWrite(path,id,data);
  if (protectedPath(path)) return confirmedWrite('updateDoc',path,id,data);

  const existing = await getLocalDoc(path, id);
  const finalData = existing ? { ...existing, ...data, id } : { id, ...data };
  await saveLocalDoc(path, id, finalData);
  notifyLocalSync(collectionPath, 'update', id);

  // Asynchronously push to server without blocking UI
  (async () => {
    try {
      const res = await fetchWithRetry('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateDoc', path, id, data: finalData })
      }, 2, 300, 10000);
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (err) {
      console.log('[Offline Mode] updateDoc queued for background sync:', path, id);
      await addToSyncQueue({ action: 'updateDoc', path: collectionPath, docId: id, data: finalData });
    }
  })();

  return { id };
}

export async function deleteDoc(docRef: MockDocumentReference): Promise<any> {
  clearQueryCache();
  const path = docRef.path;
  const id = docRef.id;
  const { collectionPath } = normalizeDocPath(path, id);
  if (protectedPath(path)) return confirmedWrite('deleteDoc',path,id);

  await removeLocalDoc(path, id);
  notifyLocalSync(collectionPath, 'delete', id);

  // Asynchronously push to server without blocking UI
  (async () => {
    try {
      const res = await fetchWithRetry('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteDoc', path, id })
      }, 2, 300, 10000);
      if (!res.ok) {
        throw new Error(await res.text());
      }
    } catch (err) {
      console.log('[Offline Mode] deleteDoc queued for background sync:', path, id);
      await addToSyncQueue({ action: 'deleteDoc', path: collectionPath, docId: id });
    }
  })();
}

let isSyncing = false;

export async function processSyncQueue(): Promise<void> {
  if (isSyncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  isSyncing = true;
  try {
    const queue = await getSyncQueue();
    if (queue.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`[Offline Sync Engine] Processing ${queue.length} pending offline actions...`);
    await flushDurableCommands();

    // 1. Process pending media uploads (e.g., offline X-Rays, attachments)
    const mediaQueue = queue.filter((item) => item.action === 'uploadOfflineMedia');
    for (const item of mediaQueue) {
      if (!item.mediaId) {
        await removeFromSyncQueue(item.id, item.createdAt);
        continue;
      }
      try {
        const media = await getOfflineMedia(item.mediaId);
        if (!media) {
          await removeFromSyncQueue(item.id, item.createdAt);
          continue;
        }

        let fileToUpload: File | null = null;
        const targetFileName = item.fileName || media.fileName || `xray_${Date.now()}.webp`;

        if (media.blob) {
          fileToUpload = new File([media.blob], targetFileName, {
            type: media.blob.type || 'image/webp'
          });
        } else if (media.dataUrl) {
          const blob = dataUrlToBlob(media.dataUrl);
          fileToUpload = new File([blob], targetFileName, {
            type: blob.type || 'image/webp'
          });
        }

        if (!fileToUpload) {
          await removeFromSyncQueue(item.id, item.createdAt);
          continue;
        }

        const clinicId = item.data?.clinicId || item.options?.clinicId || media.clinicId;
        const owner=commandOwner(getAuthToken());if(!owner||owner.split(':')[1]!==clinicId||media.owner!==owner)continue;
        const category = item.category || media.category || 'xrays';

        const publicUrl = media.uploadedUrl || await uploadFileToR2(fileToUpload, category, clinicId, targetFileName);
        await saveOfflineMedia({...media,uploadedUrl:publicUrl});

        if (publicUrl) {
          console.log(`[Offline Sync Engine] Offline media successfully uploaded to Cloudflare R2: ${publicUrl}`);
          const fieldName = item.data?.field || media.field || 'imageUrl';
          const docId = item.docId || media.docId;
          const path = item.path || media.docPath;

          if (path && docId) {
            // Keep the original bytes until the linked record is server-confirmed.
            const linked=await updateDoc(doc(db,path,docId),{[fieldName]:publicUrl,isOfflinePending:false});
            if(linked?.pending)throw new Error('ملف مرفوع وربطه محفوظ في انتظار التأكيد');

            // Update local document in IndexedDB cache
            try {
              const localDoc = await getLocalDoc(path, docId);
              if (localDoc) {
                await saveLocalDoc(path, docId, {
                  ...localDoc,
                  [fieldName]: publicUrl,
                  isOfflinePending: false
                });
              }
            } catch (e) {}

            // If there is any pending setDoc/updateDoc in sync_queue for this document, update its payload so it doesn't overwrite with old pending status
            for (const qItem of queue) {
              if (qItem.docId === docId && (qItem.action === 'setDoc' || qItem.action === 'updateDoc' || qItem.action === 'addDoc') && qItem.data) {
                qItem.data[fieldName] = publicUrl;
                qItem.data.isOfflinePending = false;
              }
            }

            notifyLocalSync(path, 'updateDoc', docId);
          }

          // Clean up from offline media store and sync queue
          await removeOfflineMedia(item.mediaId);
          await removeFromSyncQueue(item.id, item.createdAt);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('clinic-sync', {
              detail: { table: 'xrays', xrayId: docId, patientId: item.data?.patientId }
            }));
            window.dispatchEvent(new CustomEvent('clinic-sync', {
              detail: { table: 'records', xrayId: docId, patientId: item.data?.patientId }
            }));
          }
        }
      } catch (uploadErr) {
        console.warn(`[Offline Sync Engine] Failed to upload offline media ${item.mediaId} (will retry when online):`, uploadErr);
        break; // Break media loop to retry on next sync cycle
      }
    }

    // 2. Process standard database actions
    const standardQueue = queue.filter((item) => item.action !== 'uploadOfflineMedia');
    if (standardQueue.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < standardQueue.length; i += BATCH_SIZE) {
        const chunk = standardQueue.slice(i, i + BATCH_SIZE);
        const batchItems = chunk.map((item) => ({
          id: item.id || item.createdAt,
          queueItemId: item.id,
          action: item.action,
          path: item.path,
          docId: item.docId,
          data: item.data,
          options: item.options,
          createdAt: item.createdAt
        }));

        try {
          const res = await fetchWithRetry('/api/db/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: batchItems })
          }, 2, 300, 15000);

          if (res.ok) {
            const result = await res.json();
            if((result.errors||[]).some((e:any)=>e.error==='financial_sync_requires_review'))window.dispatchEvent(new CustomEvent('financial-sync-review',{detail:{message:'توجد حركات قديمة معلقة لم تحفظ ماليًا. راجعها مع المدير قبل إعادة تسجيلها.'}}));
            const processedIds = new Set((result.processedIds || []).map((pid: any) => String(pid)));

            for (const item of chunk) {
              const checkKey = item.id !== undefined ? String(item.id) : String(item.createdAt);
              if (processedIds.has(checkKey)) {
                await removeFromSyncQueue(item.id, item.createdAt);
                notifyLocalSync(item.path, item.action, item.docId);
              }
            }
          } else {
            console.log(`[Offline Sync Engine] Batch request failed with status ${res.status}. Pausing queue processing.`);
            break;
          }
        } catch (err) {
          console.log(`[Offline Sync Engine] Network notice during batch sync. Pausing queue sync.`);
          break;
        }
      }
    }
  } catch (err) {
    console.error('[Offline Sync Engine] Queue processing error:', err);
  } finally {
    isSyncing = false;
  }
}

let syncIntervalId: any = null;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Offline Sync Engine] Internet connection restored! Flushing sync queue...');
    processSyncQueue();
  });

  if (!syncIntervalId) {
    syncIntervalId = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        processSyncQueue();
      }
    }, 10000);
  }
}

export async function signInWithEmailAndPassword(_authInstance: any, email: string, pass: string) {
  const res = await fetch(getApiUrl('/api/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass })
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(errText);
    if (errText.includes('password') || errText.includes('كلمة المرور')) {
      (err as any).code = 'auth/wrong-password';
    } else {
      (err as any).code = 'auth/user-not-found';
    }
    throw err;
  }
  const result = await res.json();
  const user = { uid: result.uid, email: result.email };
  auth.currentUser = user;
  auth.onStateChangedListeners.forEach(listener => listener(user));
  return { user };
}

export async function createUserWithEmailAndPassword(_authInstance: any, email: string, pass: string) {
  const res = await fetch(getApiUrl('/api/auth/signup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass })
  });
  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(errText);
    const lowerText = errText.toLowerCase();
    if (lowerText.includes('weak') || lowerText.includes('short') || errText.includes('كلمة المرور')) {
      (err as any).code = 'auth/weak-password';
    } else if (lowerText.includes('invalid') || lowerText.includes('بريد')) {
      (err as any).code = 'auth/invalid-email';
    } else {
      (err as any).code = 'auth/email-already-in-use';
    }
    throw err;
  }
  const result = await res.json();
  const user = { uid: result.uid, email: result.email };
  auth.currentUser = user;
  auth.onStateChangedListeners.forEach(listener => listener(user));
  return { user };
}

export async function signOut(_authInstance: any) {
  auth.currentUser = null;
  clearQueryCache();
  auth.onStateChangedListeners.forEach(listener => listener(null));
}

export function getAuth(_appInstance?: any) {
  return auth;
}

export function onAuthStateChanged(_authInstance: any, callback: any) {
  auth.onStateChangedListeners.push(callback);
  callback(auth.currentUser);
  return () => {
    auth.onStateChangedListeners = auth.onStateChangedListeners.filter(l => l !== callback);
  };
}

export class GoogleAuthProvider {
  constructor() {}
}

export async function signInWithPopup(_authInstance: any, _provider: any) {
  throw new Error('تسجيل الدخول عبر Google غير مدعوم حالياً، يرجى استخدام البريد الإلكتروني وكلمة المرور.');
}

export function getStorage(_appInstance?: any) {
  return storage;
}

export function ref(_storageInstance: any, path: string) {
  return { path };
}

export async function uploadBytes(refInstance: any, blob: Blob) {
  const fullRefPath = refInstance?.path || '';
  let category = 'attachments';
  let clinicId = '';
  const parts = fullRefPath.split('/').filter(Boolean);

  if (parts.length >= 3 && parts[0] === 'clinics') {
    clinicId = parts[1];
    category = parts[2];
  } else if (parts.length >= 1) {
    category = parts[0];
  }

  const fileName = parts.length > 0 ? parts[parts.length - 1] : `file_${Date.now()}`;
  const file = new File([blob], fileName || `file_${Date.now()}`, { type: blob.type || 'application/octet-stream' });
  const publicUrl = await uploadFileToR2(file, category, clinicId, fileName);
  return {
    ref: { path: publicUrl },
    metadata: { downloadURL: publicUrl, path: publicUrl }
  };
}

export async function getDownloadURL(refInstance: any) {
  const tokenParam = getAuthToken() ? `&token=${encodeURIComponent(getAuthToken())}` : '';
  if (typeof refInstance === 'string') {
    if (refInstance.startsWith('http://') || refInstance.startsWith('https://')) {
      return refInstance;
    }
    return getApiUrl(`/api/files?path=${encodeURIComponent(refInstance)}${tokenParam}`);
  }
  if (refInstance?.path) {
    if (refInstance.path.startsWith('http://') || refInstance.path.startsWith('https://')) {
      return refInstance.path;
    }
    return getApiUrl(`/api/files?path=${encodeURIComponent(refInstance.path)}${tokenParam}`);
  }
  return '';
}


export function getFirestore(_appInstance?: any) {
  return db;
}

export function initializeFirestore(_appInstance: any, config?: any) {
  return db;
}

export function persistentLocalCache(config?: any) {
  return null;
}

export function persistentMultipleTabManager() {
  return null;
}

export function getDatabase(appInstance?: any) {
  return null;
}

export function isSupported() {
  return Promise.resolve(false);
}

export function onSnapshot(docRef_or_query: any, callback: any) {
  const refresh = () => {
    if (docRef_or_query instanceof MockDocumentReference) {
      getDoc(docRef_or_query).then(snap => callback(snap)).catch(err => console.error(err));
    } else {
      getDocs(docRef_or_query, true).then(snap => callback(snap)).catch(err => console.error(err));
    }
  };

  refresh();

  const handleSync = () => {
    refresh();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('clinic-sync', handleSync);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('clinic-sync', handleSync);
    }
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleDbError(error: unknown, operationType: OperationType, path: string | null) {
  console.error('Database Error Proxy:', error, 'Operation:', operationType, 'Path:', path);
}

// Keep old name for backward compatibility during transition
export const handleFirestoreError = handleDbError;

export function cleanDbData<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.filter(item => item !== undefined) as unknown as T;
  }
  const cleaned: any = {};
  for (const key of Object.keys(data)) {
    const val = (data as any)[key];
    if (val !== undefined) {
      cleaned[key] = val;
    }
  }
  return cleaned as T;
}

// Keep old name for backward compatibility during transition
export const cleanFirestoreData = cleanDbData;

export function getPatientsRef(clinicId: string) {
  return collection(db, "clinics", clinicId, "patients");
}

export function getClinicRef(clinicId: string) {
  return doc(db, "clinics", clinicId);
}

export function getUserRef(uid: string) {
  return doc(db, "users", uid);
}

export function getAppointmentsRef(clinicId: string) {
  return collection(db, "clinics", clinicId, "appointments");
}

export function getPatientRecordsRef(clinicId: string, patientId: string) {
  return collection(db, "clinics", clinicId, "patients", patientId, "records");
}

export function getPatientXRaysRef(clinicId: string, patientId: string) {
  return collection(db, "clinics", clinicId, "patients", patientId, "xrays");
}

export function getPrescriptionsRef(clinicId: string) {
  return collection(db, "clinics", clinicId, "prescriptions");
}

export function getCustomMedicationsRef(clinicId: string) {
  return collection(db, "clinics", clinicId, "custom_medications");
}

export function getCustomCategoriesRef(clinicId: string) {
  return collection(db, "clinics", clinicId, "custom_categories");
}

export function getRenewalsRef() {
  return collection(db, "renewals");
}

function getQueryCacheKey(q: any): string {
  if (!q) return '';
  const path = q instanceof MockQuery ? q.ref.path : q.path;
  const constraints = q instanceof MockQuery ? q.constraints : [];
  return `${path || ''}:${JSON.stringify(constraints || [])}`;
}

export async function getDocsSmart(q: any, forceRefresh = false) {
  if (forceRefresh) {
    clearQueryCache();
  } else {
    const cacheKey = getQueryCacheKey(q);
    if (cacheKey && smartDocsCache.has(cacheKey)) {
      return smartDocsCache.get(cacheKey);
    }
  }

  const result = await getDocs(q, forceRefresh);
  const cacheKey = getQueryCacheKey(q);
  if (cacheKey) {
    smartDocsCache.set(cacheKey, result);
  }
  return result;
}

export async function getDocSmart(docRef: any, forceRefresh = false) {
  if (docRef?.path && normalizeDocPath(docRef.path, docRef.id).collectionPath === "system_settings" && docRef?.id === "support") forceRefresh = true;
  if (forceRefresh) {
    clearQueryCache();
  } else {
    const cacheKey = docRef?.path || '';
    if (cacheKey && smartDocCache.has(cacheKey)) {
      return smartDocCache.get(cacheKey);
    }
  }

  const result = await getDoc(docRef, forceRefresh);
  const cacheKey = docRef?.path || '';
  if (cacheKey) {
    smartDocCache.set(cacheKey, result);
  }
  return result;
}

export interface User {
  uid: string;
  email: string | null;
  displayName?: string | null;
}
