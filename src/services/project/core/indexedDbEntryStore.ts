// IndexedDB persistence for the fallback project storage. Both the editor and
// the project storage worker open this same origin database, so a repository
// created on the main thread is the one the worker reopens and saves into.
//
// Content is stored as ArrayBuffer chunks: WebKit has refused Blob values in
// IndexedDB in Private Browsing, while plain buffers are accepted.

import { fallbackNotFound, type FallbackEntry, type FallbackEntryStore } from './fallbackDirectoryHandle';

const DATABASE_NAME = 'ms-browser-project-storage';
const ENTRIES = 'entries';
const CHUNKS = 'chunks';

interface StoredChunk { contentId: string; index: number; bytes: ArrayBuffer }

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Browser storage transaction aborted', 'AbortError'));
  });
}

const chunkRange = (contentId: string) => IDBKeyRange.bound([contentId, 0], [contentId, Number.MAX_SAFE_INTEGER]);
const descendantRange = (path: string) => IDBKeyRange.bound(`${path}/`, `${path}/￿`);

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore(ENTRIES, { keyPath: 'path' });
      entries.createIndex('parent', 'parent');
      request.result.createObjectStore(CHUNKS, { keyPath: ['contentId', 'index'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException('Browser project storage is blocked by another tab', 'InvalidStateError'));
  });
}

/** Opens the store and proves that it accepts writes before projects depend on it. */
export async function openIndexedDbEntryStore(): Promise<FallbackEntryStore> {
  if (typeof indexedDB === 'undefined') throw new DOMException('IndexedDB is unavailable in this browser', 'NotSupportedError');
  const db = await openDatabase();
  // Another tab upgrading the schema must not wait on this connection forever.
  db.onversionchange = () => db.close();

  const transaction = (stores: string[], mode: IDBTransactionMode) => db.transaction(stores, mode);
  const store: FallbackEntryStore = {
    async get(path) {
      return settle<FallbackEntry | undefined>(transaction([ENTRIES], 'readonly').objectStore(ENTRIES).get(path));
    },
    async children(parent) {
      const entries = await settle<FallbackEntry[]>(transaction([ENTRIES], 'readonly').objectStore(ENTRIES).index('parent').getAll(parent));
      return entries.toSorted((left, right) => left.name.localeCompare(right.name));
    },
    async ensure(entry) {
      const tx = transaction([ENTRIES], 'readwrite'); const done = completion(tx); const entries = tx.objectStore(ENTRIES);
      const existing = await settle<FallbackEntry | undefined>(entries.get(entry.path));
      if (existing) { await done; return existing; }
      if (entry.parent && !await settle<FallbackEntry | undefined>(entries.get(entry.parent))) {
        tx.abort(); await done.catch(() => {}); throw fallbackNotFound(entry.parent);
      }
      entries.add(entry); await done; return entry;
    },
    async remove(path) {
      const tx = transaction([ENTRIES, CHUNKS], 'readwrite'); const done = completion(tx);
      const entries = tx.objectStore(ENTRIES); const chunks = tx.objectStore(CHUNKS);
      const removed = [await settle<FallbackEntry | undefined>(entries.get(path)), ...await settle<FallbackEntry[]>(entries.getAll(descendantRange(path)))];
      for (const entry of removed) if (entry?.contentId) chunks.delete(chunkRange(entry.contentId));
      entries.delete(path); entries.delete(descendantRange(path));
      await done;
    },
    async putChunk(contentId, index, bytes) {
      const tx = transaction([CHUNKS], 'readwrite'); const done = completion(tx);
      tx.objectStore(CHUNKS).put({ contentId, index, bytes } satisfies StoredChunk); await done;
    },
    async readChunks(contentId) {
      const chunks = await settle<StoredChunk[]>(transaction([CHUNKS], 'readonly').objectStore(CHUNKS).getAll(chunkRange(contentId)));
      return chunks.map(chunk => chunk.bytes);
    },
    async commit(path, contentId, size, lastModified) {
      const tx = transaction([ENTRIES, CHUNKS], 'readwrite'); const done = completion(tx); const entries = tx.objectStore(ENTRIES);
      const entry = await settle<FallbackEntry | undefined>(entries.get(path));
      if (!entry || entry.kind !== 'file') { tx.abort(); await done.catch(() => {}); throw fallbackNotFound(path); }
      if (entry.contentId) tx.objectStore(CHUNKS).delete(chunkRange(entry.contentId));
      entries.put({ ...entry, contentId, size, lastModified } satisfies FallbackEntry);
      await done;
    },
    async discard(contentId) {
      const tx = transaction([CHUNKS], 'readwrite'); const done = completion(tx);
      tx.objectStore(CHUNKS).delete(chunkRange(contentId)); await done;
    },
  };

  // Some private modes open the database but reject every write; find out now.
  const probe = `.probe-${crypto.randomUUID()}`;
  try {
    await store.ensure({ path: probe, parent: '', name: probe, kind: 'file', size: 0, lastModified: Date.now(), contentId: null });
    await store.remove(probe);
  } catch (error) { db.close(); throw error; }
  return store;
}

/**
 * Whether this origin ever created the fallback database, without creating it.
 * Unknown (no `indexedDB.databases()`) counts as absent: nothing is offered then.
 */
export async function fallbackStoreExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  try { return (await indexedDB.databases()).some(database => database.name === DATABASE_NAME); } catch { return false; }
}
