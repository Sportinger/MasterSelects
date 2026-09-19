import { Logger } from '../../../services/logger';

const log = Logger.create('FlockCheckpointStore');
const DB_NAME = 'masterselects-flock-cache';
const DB_VERSION = 1;
const STORE = 'checkpoints';

/**
 * Persisted restart checkpoints for precomputed flock ranges. Keyed by a
 * cache key covering solver version, program semantics, keyframes and the
 * validated host; never contains the editable definition, so quota failures
 * cannot lose project data.
 */
export interface FlockCheckpointRecord {
  id: string;
  cacheKey: string;
  clipId: string;
  step: number;
  createdAt: number;
  bytes: number;
  state: ArrayBuffer;
  rings: ArrayBuffer[];
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('cacheKey', 'cacheKey');
          store.createIndex('clipId', 'clipId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        log.warn('Flock checkpoint cache unavailable', request.error);
        resolve(null);
      };
    } catch (error) {
      log.warn('Flock checkpoint cache unavailable', error);
      resolve(null);
    }
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const flockCheckpointStore = {
  async put(record: Omit<FlockCheckpointRecord, 'id' | 'createdAt' | 'bytes'>): Promise<{ ok: boolean; message?: string }> {
    const db = await openDb();
    if (!db) return { ok: false, message: 'Persistent cache is unavailable in this browser.' };
    const full: FlockCheckpointRecord = {
      ...record,
      id: `${record.cacheKey}|${record.step}`,
      createdAt: Date.now(),
      bytes: record.state.byteLength + record.rings.reduce((sum, ring) => sum + ring.byteLength, 0),
    };
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(full);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Storage quota exceeded while persisting the flock cache. The clip definition is unchanged.'
        : `Could not persist flock cache: ${error instanceof Error ? error.message : String(error)}`;
      log.warn(message);
      return { ok: false, message };
    }
  },

  async listSteps(cacheKey: string): Promise<number[]> {
    const db = await openDb();
    if (!db) return [];
    try {
      const transaction = db.transaction(STORE, 'readonly');
      const keys = await requestToPromise(transaction.objectStore(STORE).index('cacheKey').getAllKeys(IDBKeyRange.only(cacheKey)));
      return keys
        .map((key) => Number(String(key).split('|').pop()))
        .filter((step) => Number.isFinite(step))
        .toSorted((a, b) => a - b);
    } catch {
      return [];
    }
  },

  async get(cacheKey: string, step: number): Promise<FlockCheckpointRecord | null> {
    const db = await openDb();
    if (!db) return null;
    try {
      const transaction = db.transaction(STORE, 'readonly');
      return (await requestToPromise(transaction.objectStore(STORE).get(`${cacheKey}|${step}`))) as FlockCheckpointRecord | null ?? null;
    } catch {
      return null;
    }
  },

  /** Removes a clip's records whose cache key is no longer current (safe pruning). */
  async pruneClip(clipId: string, keepCacheKey?: string): Promise<number> {
    const db = await openDb();
    if (!db) return 0;
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const records = (await requestToPromise(store.index('clipId').getAll(IDBKeyRange.only(clipId)))) as FlockCheckpointRecord[];
      let removed = 0;
      for (const record of records) {
        if (record.cacheKey === keepCacheKey) continue;
        store.delete(record.id);
        removed += 1;
      }
      return removed;
    } catch {
      return 0;
    }
  },
};
