import { StreamHash } from './streamHash';

/**
 * Full-content hashing of original media, resumable across reloads. A 124 GB camera original
 * takes over ten minutes; restarting from byte 0 on every reload meant it never finished and
 * the whole file was read again on each project open. Progress is checkpointed per file
 * (name, size, modification time) in IndexedDB and continued on the next run.
 */
const DB_NAME = 'ms-source-hash-checkpoints';
const STORE = 'checkpoints';
const CHUNK_BYTES = 1024 * 1024;
const CHECKPOINT_BYTES = 512 * 1024 * 1024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Checkpoint { key: string; offset: number; state: number[]; savedAt: number }

export function sourceHashCheckpointKey(blob: Blob): string | null {
  // Only files have a stable identity; a plain Blob is hashed in one run.
  if (typeof File === 'undefined' || !(blob instanceof File)) return null;
  return `${blob.size}:${blob.lastModified}:${blob.name}`;
}

function openStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'key' }); };
    request.onsuccess = () => resolve(request.result);
    // Without storage the hash still completes, it only cannot resume.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export interface SourceHashCheckpointStore {
  load(key: string): Promise<{ offset: number; state: number[] } | null>;
  save(key: string, offset: number, state: number[]): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createIndexedDbCheckpointStore(): SourceHashCheckpointStore {
  let database: Promise<IDBDatabase | null> | null = null;
  const db = () => database ??= openStore();
  return {
    async load(key) {
      const opened = await db(); if (!opened) return null;
      const value = await run<Checkpoint | undefined>(opened, 'readonly', store => store.get(key)).catch(() => undefined);
      if (!value || Date.now() - value.savedAt > MAX_AGE_MS) return null;
      return { offset: value.offset, state: value.state };
    },
    async save(key, offset, state) {
      const opened = await db(); if (!opened) return;
      await run(opened, 'readwrite', store => {
        store.put({ key, offset, state, savedAt: Date.now() } satisfies Checkpoint);
        // Drop checkpoints of files that were never finished within a month.
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result; if (!entry) return;
          if (Date.now() - (entry.value as Checkpoint).savedAt > MAX_AGE_MS) entry.delete();
          entry.continue();
        };
      }).catch(() => {});
    },
    async remove(key) {
      const opened = await db(); if (!opened) return;
      await run(opened, 'readwrite', store => { store.delete(key); }).catch(() => {});
    },
  };
}

/** SHA-256 of all bytes of `blob`, continuing a checkpoint of an earlier, interrupted run of the same file. */
export async function hashSourceResumable(
  blob: Blob,
  signal: AbortSignal,
  onRead?: (bytes: number) => void,
  checkpoints: SourceHashCheckpointStore = defaultStore(),
): Promise<{ hash: string; resumedAt: number }> {
  const key = sourceHashCheckpointKey(blob);
  const saved = key ? await checkpoints.load(key) : null;
  const resumable = saved && saved.offset > 0 && saved.offset < blob.size && saved.offset % CHUNK_BYTES === 0;
  const hash = resumable ? StreamHash.resume({ state: saved.state, size: saved.offset }) : new StreamHash();
  const resumedAt = resumable ? saved.offset : 0;
  let lastCheckpoint = resumedAt;
  for (let offset = resumedAt; offset < blob.size; offset += CHUNK_BYTES) {
    signal.throwIfAborted();
    const end = Math.min(blob.size, offset + CHUNK_BYTES);
    hash.update(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
    onRead?.(end);
    if (key && end < blob.size && end - lastCheckpoint >= CHECKPOINT_BYTES) {
      const snapshot = hash.snapshot();
      if (snapshot) { await checkpoints.save(key, end, snapshot.state); lastCheckpoint = end; }
    }
  }
  signal.throwIfAborted();
  const digest = hash.digest();
  if (key) await checkpoints.remove(key);
  return { hash: digest, resumedAt };
}

let shared: SourceHashCheckpointStore | null = null;
function defaultStore(): SourceHashCheckpointStore { return shared ??= createIndexedDbCheckpointStore(); }
