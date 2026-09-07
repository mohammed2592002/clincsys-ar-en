import { safeStorage } from './storage';

const DB_NAME = 'CrownDentOfflineDB';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function getIDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'key' });
          docStore.createIndex('path', 'path', { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('offline_media')) {
          db.createObjectStore('offline_media', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

export interface CachedDoc {
  key: string;
  path: string;
  id: string;
  data: any;
  updatedAt: number;
}

export interface OfflineMediaItem {
  id: string; // Unique media key (e.g. media_123456789)
  blob?: Blob;
  dataUrl?: string;
  mimeType?: string;
  fileName?: string;
  category?: string;
  clinicId?: string;
  patientId?: string;
  docPath?: string;
  docId?: string;
  field?: string;
  status?: 'pending' | 'synced' | 'failed';
  createdAt: number;
}

export interface QueueItem {
  id?: number;
  action: 'addDoc' | 'setDoc' | 'updateDoc' | 'deleteDoc' | 'uploadOfflineMedia';
  path: string;
  docId?: string;
  data?: any;
  options?: any;
  mediaId?: string;
  category?: string;
  fileName?: string;
  createdAt: number;
}

export function normalizeDocPath(path: string, id: string): { collectionPath: string; docKey: string } {
  let cleanPath = (path || '').replace(/\/+$|^\/+/g, '');
  const cleanId = (id || '').trim();
  if (cleanId && cleanPath.endsWith('/' + cleanId)) {
    cleanPath = cleanPath.substring(0, cleanPath.length - cleanId.length - 1);
  }
  return {
    collectionPath: cleanPath,
    docKey: `${cleanPath}:${cleanId}`
  };
}

export async function saveLocalDoc(path: string, id: string, data: any): Promise<void> {
  if (!id) return;
  const { collectionPath, docKey } = normalizeDocPath(path, id);
  const docItem: CachedDoc = { key: docKey, path: collectionPath, id, data: { ...data, id }, updatedAt: Date.now() };

  try {
    const idb = await getIDB();
    // Wait for the transaction to fully complete before resolving
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('documents', 'readwrite');
      const req = tx.objectStore('documents').put(docItem);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    safeStorage.setItem(`offline_doc_${docKey}`, JSON.stringify(docItem));
  }
}

export async function getLocalDoc(path: string, id: string): Promise<any | null> {
  const { docKey } = normalizeDocPath(path, id);
  try {
    const idb = await getIDB();
    const tx = idb.transaction('documents', 'readonly');
    const req = tx.objectStore('documents').get(docKey);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    const item = safeStorage.getItem(`offline_doc_${docKey}`);
    if (item) {
      try {
        return JSON.parse(item).data;
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

export async function removeLocalDoc(path: string, id: string): Promise<void> {
  const { docKey } = normalizeDocPath(path, id);
  const rawKey = `${path}:${id}`;

  // Always clean safeStorage as well
  safeStorage.removeItem(`offline_doc_${docKey}`);
  if (rawKey !== docKey) {
    safeStorage.removeItem(`offline_doc_${rawKey}`);
  }

  try {
    const idb = await getIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('documents', 'readwrite');
      const store = tx.objectStore('documents');
      store.delete(docKey);
      if (rawKey !== docKey) {
        store.delete(rawKey);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Already cleaned safeStorage above
  }
}

export async function getLocalDocsForPath(path: string): Promise<any[]> {
  try {
    const idb = await getIDB();
    const tx = idb.transaction('documents', 'readonly');
    const index = tx.objectStore('documents').index('path');
    const req = index.getAll(path);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve((req.result || []).map((item: CachedDoc) => item.data));
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    const results: any[] = [];
    const prefix = `offline_doc_${path}:`;
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          try {
            const parsed = JSON.parse(localStorage.getItem(k) || '');
            if (parsed && parsed.data) results.push(parsed.data);
          } catch (e) {}
        }
      }
    }
    return results;
  }
}

export async function addToSyncQueue(item: Omit<QueueItem, 'id' | 'createdAt'>): Promise<void> {
  const queueItem: QueueItem = { ...item, createdAt: Date.now() };
  try {
    const idb = await getIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('sync_queue', 'readwrite');
      const req = tx.objectStore('sync_queue').add(queueItem);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    const raw = safeStorage.getItem('offline_sync_queue') || '[]';
    try {
      const q = JSON.parse(raw);
      q.push(queueItem);
      safeStorage.setItem('offline_sync_queue', JSON.stringify(q));
    } catch (e) {}
  }
}

export async function isDocPendingInSyncQueue(path: string, docId: string): Promise<boolean> {
  const { collectionPath } = normalizeDocPath(path, docId);
  const queue = await getSyncQueue();
  return queue.some((item) => {
    const itemNorm = normalizeDocPath(item.path, item.docId || '');
    return itemNorm.collectionPath === collectionPath && item.docId === docId;
  });
}

export async function getSyncQueue(): Promise<QueueItem[]> {
  try {
    const idb = await getIDB();
    const tx = idb.transaction('sync_queue', 'readonly');
    const req = tx.objectStore('sync_queue').getAll();
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    const raw = safeStorage.getItem('offline_sync_queue') || '[]';
    try {
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
}

export async function removeFromSyncQueue(id?: number, createdAt?: number): Promise<void> {
  try {
    if (id !== undefined && typeof indexedDB !== 'undefined') {
      const idb = await getIDB();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    }
  } catch (err) {}

  const raw = safeStorage.getItem('offline_sync_queue') || '[]';
  try {
    let q: QueueItem[] = JSON.parse(raw);
    if (createdAt) {
      q = q.filter((i) => i.createdAt !== createdAt);
    } else if (id !== undefined) {
      q = q.filter((i) => i.id !== id);
    }
    safeStorage.setItem('offline_sync_queue', JSON.stringify(q));
  } catch (e) {}
}

export function filterAndSortLocalDocs(docs: any[], constraints: any[]): any[] {
  let result = [...docs];

  if (!constraints || constraints.length === 0) {
    return result;
  }

  // Process constraints in order: where → orderBy → startAfter → limit
  // First pass: apply where filters
  for (const c of constraints) {
    if (c.type === 'where') {
      const { field, op, value } = c;
      result = result.filter((doc) => {
        const val = doc[field];
        if (op === '==' || op === '===') return val === value;
        if (op === '!=') return val !== value;
        if (op === '>') return val > value;
        if (op === '>=') return val >= value;
        if (op === '<') return val < value;
        if (op === '<=') return val <= value;
        if (op === 'in') return Array.isArray(value) && value.includes(val);
        if (op === 'array-contains') return Array.isArray(val) && val.includes(value);
        return true;
      });
    }
  }

  // Second pass: apply orderBy
  for (const c of constraints) {
    if (c.type === 'orderBy') {
      const { field, direction } = c;
      result.sort((a, b) => {
        const valA = a[field];
        const valB = b[field];
        if (valA === valB) {
          if (a.id === b.id) return 0;
          if (direction === 'desc') {
            return a.id < b.id ? 1 : -1;
          }
          return a.id > b.id ? 1 : -1;
        }
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (direction === 'desc') {
          return valA < valB ? 1 : -1;
        }
        return valA > valB ? 1 : -1;
      });
    }
  }

  // Third pass: apply startAfter (cursor-based pagination)
  for (const c of constraints) {
    if (c.type === 'startAfter' && c.docSnap) {
      const cursorId = c.docSnap.id;
      const cursorIdx = result.findIndex(doc => doc.id === cursorId);
      if (cursorIdx !== -1) {
        result = result.slice(cursorIdx + 1);
      }
    }
  }

  // Fourth pass: apply limit
  for (const c of constraints) {
    if (c.type === 'limit') {
      result = result.slice(0, c.limit);
    }
  }

  return result;
}

export async function saveOfflineMedia(item: OfflineMediaItem): Promise<void> {
  if (!item || !item.id) return;
  try {
    const idb = await getIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('offline_media', 'readwrite');
      tx.objectStore('offline_media').put({
        ...item,
        status: item.status || 'pending',
        createdAt: item.createdAt || Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Error saving offline media to IDB:', err);
  }
}

export async function getOfflineMedia(id: string): Promise<OfflineMediaItem | null> {
  if (!id) return null;
  try {
    const idb = await getIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction('offline_media', 'readonly');
      const req = tx.objectStore('offline_media').get(id);
      req.onsuccess = () => {
        const item: OfflineMediaItem = req.result;
        if (!item) {
          resolve(null);
          return;
        }

        // If dataUrl was stored as an expired blob URL, recreate a valid one from item.blob
        if (item.blob && (!item.dataUrl || item.dataUrl.startsWith('blob:'))) {
          try {
            item.dataUrl = URL.createObjectURL(item.blob);
          } catch (e) {}
        }
        resolve(item);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

export async function removeOfflineMedia(id: string): Promise<void> {
  if (!id) return;
  try {
    const idb = await getIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('offline_media', 'readwrite');
      tx.objectStore('offline_media').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[OfflineDB] Error removing offline media:', err);
  }
}

export async function getAllPendingOfflineMedia(): Promise<OfflineMediaItem[]> {
  try {
    const idb = await getIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction('offline_media', 'readonly');
      const req = tx.objectStore('offline_media').getAll();
      req.onsuccess = () => {
        const items: OfflineMediaItem[] = req.result || [];
        resolve(items.filter(i => i.status !== 'synced'));
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    return [];
  }
}
