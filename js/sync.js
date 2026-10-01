// SyncEngine: replicates the local IndexedDB store to the server.
// - flush(): pushes queued operations (upsert / delete) in order
// - pull(): fetches everything that changed on the server since the cursor
// Runs on app start, when the browser goes online, every 30 seconds and on
// demand (manual "sync now" from the header pill).
import { DB, applyServerRecord } from './db.js';
import { api } from './api.js';
import { getUser } from './auth.js';

const LAST_PULL_KEY = 'tukent_lastPull';
const LAST_SYNC_KEY = 'tukent_lastSync';
const BATCH_SIZE = 200;
const INTERVAL_MS = 30000;

const listeners = new Set();
let running = false;
let rerunQueued = false;
let timer = null;

const state = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  pending: 0,
  lastSyncAt: Number(localStorage.getItem(LAST_SYNC_KEY) || 0),
  error: ''
};

export function getStatus() {
  return { ...state };
}

export function onStatus(fn) {
  listeners.add(fn);
  fn(getStatus());
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getStatus();
  listeners.forEach((fn) => fn(snapshot));
}

async function refreshPendingCount() {
  try {
    state.pending = await DB.pendingCount();
  } catch (e) { /* IndexedDB unavailable */ }
}

// Push queued operations until the queue is empty.
async function flush() {
  let pushed = 0;
  for (;;) {
    const ops = await DB.getPendingOps(BATCH_SIZE);
    if (!ops.length) break;
    const payload = ops.map((op) => ({ entity: op.entity, op: op.op, data: op.data }));
    const result = await api.pushOps(payload);
    if (result && Array.isArray(result.errors)) {
      result.errors.forEach((msg) => console.warn('[sync] server rejected an operation:', msg));
    }
    await DB.removePendingOps(ops.map((op) => op.seq));
    pushed += ops.length;
    if (ops.length < BATCH_SIZE) break;
  }
  return pushed;
}

// Pull server changes since the stored cursor and apply them locally.
async function pull() {
  const since = Number(localStorage.getItem(LAST_PULL_KEY) || 0);
  const data = await api.pullChanges(since);
  const records = (data && data.records) || {};
  for (const entity of Object.keys(records)) {
    for (const record of records[entity]) {
      await applyServerRecord(entity, record);
    }
  }
  localStorage.setItem(LAST_PULL_KEY, String(data.serverTime || Date.now()));
}

export async function syncNow(reason = 'manual') {
  if (running) {
    rerunQueued = true;
    return;
  }
  state.online = navigator.onLine;
  if (!state.online || !getUser()) {
    await refreshPendingCount();
    emit();
    return;
  }

  running = true;
  state.syncing = true;
  state.error = '';
  emit();

  try {
    const pushed = await flush();
    await pull();
    state.lastSyncAt = Date.now();
    localStorage.setItem(LAST_SYNC_KEY, String(state.lastSyncAt));
    document.dispatchEvent(new CustomEvent('tukent:synced', { detail: { pushed, reason } }));
  } catch (e) {
    state.error = e && e.message ? e.message : 'Sync failed';
    console.warn('[sync]', e);
  } finally {
    running = false;
    state.syncing = false;
    await refreshPendingCount();
    emit();
    if (rerunQueued) {
      rerunQueued = false;
      syncNow('rerun');
    }
  }
}

// Called by pages right after a local write; updates the pending badge and
// pushes eagerly when a connection is available.
export async function notifyLocalChange() {
  await refreshPendingCount();
  emit();
  syncNow('local-change');
}

export function startSyncEngine() {
  window.addEventListener('online', () => {
    state.online = true;
    emit();
    syncNow('online');
  });
  window.addEventListener('offline', () => {
    state.online = false;
    emit();
  });
  if (timer) clearInterval(timer);
  timer = setInterval(() => syncNow('timer'), INTERVAL_MS);
  refreshPendingCount().then(emit);
  syncNow('start');
}
