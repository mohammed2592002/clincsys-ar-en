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
        signal: controller.signal
      });
      clearTimeout(timer);
      if (options.signal && callerAbortListener) {
        options.signal.removeEventListener('abort', callerAbortListener);
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
    if (docData) {
      saveLocalDoc(path, id, docData).catch(() => {});
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

export async function addDoc(collectionRef: MockCollectionReference, data: any): Promise<any> {
  clearQueryCache();
  const path = collectionRef.path;
  const id = generateAutoId();
  const docData = { ...data, id };

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
        const category = item.category || media.category || 'xrays';

        const publicUrl = await uploadFileToR2(fileToUpload, category, clinicId, targetFileName);

        if (publicUrl) {
          console.log(`[Offline Sync Engine] Offline media successfully uploaded to Cloudflare R2: ${publicUrl}`);
          const fieldName = item.data?.field || media.field || 'imageUrl';
          const docId = item.docId || media.docId;
          const path = item.path || media.docPath;

          if (path && docId) {
            // Update database record on server
            try {
              await fetchWithRetry('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'updateDoc',
                  path,
                  id: docId,
                  data: { [fieldName]: publicUrl, isOfflinePending: false }
                })
              }, 2, 300, 10000);
            } catch (e) {
              console.warn('[Offline Sync Engine] Notice updating doc after R2 upload:', e);
            }

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
  if (typeof refInstance === 'string') {
    if (refInstance.startsWith('http://') || refInstance.startsWith('https://')) {
      return refInstance;
    }
    return getApiUrl(`/api/files?path=${encodeURIComponent(refInstance)}`);
  }
  if (refInstance?.path) {
    if (refInstance.path.startsWith('http://') || refInstance.path.startsWith('https://')) {
      return refInstance.path;
    }
    return getApiUrl(`/api/files?path=${encodeURIComponent(refInstance.path)}`);
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

  const result = await getDocs(q);
  const cacheKey = getQueryCacheKey(q);
  if (cacheKey) {
    smartDocsCache.set(cacheKey, result);
  }
  return result;
}

export async function getDocSmart(docRef: any, forceRefresh = false) {
  if (forceRefresh) {
    clearQueryCache();
  } else {
    const cacheKey = docRef?.path || '';
    if (cacheKey && smartDocCache.has(cacheKey)) {
      return smartDocCache.get(cacheKey);
    }
  }

  const result = await getDoc(docRef);
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
