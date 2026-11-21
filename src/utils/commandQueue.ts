import {stableJson} from './documentComparison';
// Durable commands are written before any optimistic UI update.
export interface DurableCommand {
  id: string;
  owner: string;
  clinicId: string;
  body: any;
  fingerprint: string;
  createdAt: string;
  status: "pending" | "conflict" | "resolved";
  resolution?: string;
  resolvedAt?: string;
  error?: string;
  localPath?: string;
  localId?: string;
  financial: boolean;
  actorName?: string;
  actorRole?: string;
  entityName?: string;
  conflict?: any;
  sequence?: number;
}
let database: Promise<IDBDatabase> | null = null;
function open() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("CoreDentCommands", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("commands", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      database = null;
      reject(r.error);
    };
  }));
}
export async function listCommands(
  includeResolved = false,
): Promise<DurableCommand[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("commands");
    const r = tx.objectStore("commands").getAll();
    r.onsuccess = () =>
      resolve(
        (r.result || [])
          .filter(
            (c: DurableCommand) => includeResolved || c.status !== "resolved",
          )
          .sort((a, b) =>
            a.sequence && b.sequence
              ? a.sequence - b.sequence
              : a.createdAt.localeCompare(b.createdAt),
          ),
      );
    r.onerror = () => reject(r.error);
  });
}
export async function saveCommand(command: DurableCommand) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("commands", "readwrite");
    tx.objectStore("commands").put(command);
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error || new Error("تعذر حفظ الطلب على الجهاز، لم يتم تسجيله"));
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event("offline-commands-changed"));
}
export async function removeCommand(id: string) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("commands", "readwrite");
    tx.objectStore("commands").delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event("offline-commands-changed"));
}
export function commandOwner(token: string) {
  try {
    const raw = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return [raw.type, raw.clinicId || "", raw.staffId || ""].join(":");
  } catch {
    return "";
  }
}
export function commandFingerprint(clinicId: string, body: any) {
  const copy = JSON.parse(JSON.stringify(body));
  delete copy.requestId;
  delete copy.clientOccurredAt;
  delete copy.queuedBy;
  if (copy.create) {
    delete copy.id;
    if (copy.data) {
      delete copy.data.id;
      delete copy.data.createdAt;
      delete copy.data.updatedAt;
    }
  }
  if (copy.data) delete copy.data.updatedAt;
  if (copy.base) delete copy.base.updatedAt;
  // Two tabs can observe different local snapshots for the same pending edit.
  // Identical non-financial intent must retain the first command and its base.
  if (copy.optimistic && copy.action === "write") delete copy.base;
  return stableJson({ clinicId, ...copy });
}
export async function enqueueCommand(
  command: DurableCommand,
): Promise<DurableCommand> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("commands", "readwrite"),
      store = tx.objectStore("commands");
    let chosen = command;
    const read = store.getAll();
    read.onsuccess = () => {
      const existing = read.result.find(
        (c: DurableCommand) =>
          c.status !== "resolved" &&
          c.owner === command.owner &&
          (c.fingerprint === command.fingerprint ||
            (c.body.optimistic && command.body.optimistic &&
              commandFingerprint(c.clinicId, c.body) === command.fingerprint)),
      );
      if (existing) chosen = existing;
      else {
        command.sequence =
          Math.max(
            0,
            ...read.result.map((c: DurableCommand) => c.sequence || 0),
          ) + 1;
        store.put(command);
      }
    };
    tx.oncomplete = () => {
      window.dispatchEvent(new Event("offline-commands-changed"));
      resolve(chosen);
    };
    tx.onabort = () =>
      reject(tx.error || new Error("تعذر حفظ الطلب على الجهاز"));
    tx.onerror = () => reject(tx.error);
  });
}

export async function settleConflict(
  command: DurableCommand,
  replacement?: DurableCommand,
) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("commands", "readwrite"),
      store = tx.objectStore("commands"),
      read = store.get(command.id);
    read.onsuccess = () => {
      if (read.result?.status !== "conflict") {
        tx.abort();
        return;
      }
      store.put(command);
      if (replacement) store.put(replacement);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("تغير الطلب، أعد تحميل التنبيهات"));
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event("offline-commands-changed"));
}
