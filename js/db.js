// Offline-first local store: IndexedDB wrapper + pending-operation queue.
// Every page writes here first (works with no network); the SyncEngine
// (js/sync.js) replicates the queued operations to the server when online.

const DB_NAME = 'tukent';
const DB_VERSION = 1;

export const ENTITIES = [
  'products', 'inventory_movements', 'sales_orders',
  'vehicles', 'drivers', 'trips',
  'menu_items', 'restaurant_orders', 'reservations'
];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ENTITIES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pendingOps')) {
        db.createObjectStore('pendingOps', { keyPath: 'seq', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function storeOp(storeName, mode, fn) {
  const db = await open();
  const tx = db.transaction(storeName, mode);
  const result = await requestPromise(fn(tx.objectStore(storeName)));
  await txDone(tx);
  return result;
}

export const DB = {
  async getAll(entity) {
    const db = await open();
    return requestPromise(db.transaction(entity).objectStore(entity).getAll());
  },

  async get(entity, id) {
    const db = await open();
    return requestPromise(db.transaction(entity).objectStore(entity).get(id));
  },

  async put(entity, record) {
    return storeOp(entity, 'readwrite', (store) => store.put(record));
  },

  async remove(entity, id) {
    return storeOp(entity, 'readwrite', (store) => store.delete(id));
  },

  async enqueue(op) {
    return storeOp('pendingOps', 'readwrite', (store) => store.add({ ...op, ts: op.ts || Date.now() }));
  },

  async getPendingOps(limit = 200) {
    const all = await storeOp('pendingOps', 'readonly', (store) => store.getAll());
    return (all || []).slice(0, limit);
  },

  async removePendingOps(seqs) {
    const db = await open();
    const tx = db.transaction('pendingOps', 'readwrite');
    const store = tx.objectStore('pendingOps');
    seqs.forEach((seq) => store.delete(seq));
    return txDone(tx);
  },

  async pendingCount() {
    const db = await open();
    return requestPromise(db.transaction('pendingOps').objectStore('pendingOps').count());
  },

  async getMeta(key) {
    const db = await open();
    const row = await requestPromise(db.transaction('meta').objectStore('meta').get(key));
    return row ? row.value : null;
  },

  async setMeta(key, value) {
    return storeOp('meta', 'readwrite', (store) => store.put({ key, value }));
  }
};

// ---- High-level operations used by the pages --------------------------------

// Create or update a record locally and queue it for sync.
export async function saveRecord(entity, record) {
  const ts = Date.now();
  const doc = {
    ...record,
    id: record.id || uuid(),
    updated_at: ts,
    created_at: record.created_at || ts,
    deleted: 0
  };
  await DB.put(entity, doc);
  await DB.enqueue({ entity, op: 'upsert', data: doc, ts });
  return doc;
}

// Remove a record locally and queue a soft-delete for the server.
export async function deleteRecord(entity, id) {
  const ts = Date.now();
  await DB.remove(entity, id);
  await DB.enqueue({ entity, op: 'delete', data: { id, updated_at: ts }, ts });
  return id;
}

// Apply a record coming from the server (used by the SyncEngine).
// Skips the write when the local copy is newer (a queued offline edit).
export async function applyServerRecord(entity, record) {
  const local = await DB.get(entity, record.id);
  if (local && Number(local.updated_at) > Number(record.updated_at)) return;
  if (record.deleted) await DB.remove(entity, record.id);
  else await DB.put(entity, record);
}

// UUID with fallback for non-secure contexts (plain http over LAN),
// where crypto.randomUUID is unavailable.
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (e) { /* fall through */ }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
