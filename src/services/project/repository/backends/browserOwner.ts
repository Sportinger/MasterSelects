import { RepositoryError, type RepositoryOwner } from '../contracts';

/** Repository and physical location locks are held for the entire writer lifetime. */
export async function acquireBrowserOwner(locationId: string, repositoryId: string, signal?: AbortSignal): Promise<RepositoryOwner | null> {
  if (!navigator.locks) return null;
  const epoch = crypto.randomUUID();
  let owned = false;
  let unlock!: () => void;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const releaseGate = new Promise<void>(resolve => { unlock = resolve; });
  const pending = new Promise<RepositoryOwner | null>((resolve, reject) => {
    const run = navigator.locks.request(`ms.repository.location:${locationId}`, { ifAvailable: true }, async location => {
      if (!location) { resolve(null); return; }
      await navigator.locks.request(`ms.repository.writer:${repositoryId}`, { ifAvailable: true }, async repository => {
        if (!repository || signal?.aborted) { resolve(null); return; }
        owned = true;
        resolve({ writerEpoch: epoch, assertOwned() { if (!owned || signal?.aborted) throw new RepositoryError('ownership', 'Repository writer ownership was lost'); }, async release() { owned = false; unlock(); await finished; } });
        await releaseGate;
        owned = false;
      });
    });
    run.catch(reject).finally(finish);
  });
  const abort = () => { owned = false; unlock(); };
  signal?.addEventListener('abort', abort, { once: true });
  finished.finally(() => signal?.removeEventListener('abort', abort));
  return pending;
}

/** Persist handles separately from transportable project records. Registration itself is locked. */
export async function registerFsaLocation(handle: FileSystemDirectoryHandle): Promise<string> {
  if (!navigator.locks || !globalThis.indexedDB) return `fsa-readonly:${crypto.randomUUID()}`;
  return navigator.locks.request('ms.repository.location-registry', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ms-repository-locations', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      let cursor: string | undefined;
      for (;;) {
        const entries = await new Promise<{ id: string; handle: FileSystemDirectoryHandle }[]>((resolve, reject) => {
          const request = db.transaction('handles').objectStore('handles').getAll(cursor ? IDBKeyRange.lowerBound(cursor, true) : undefined, 64);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        for (const entry of entries) if (await handle.isSameEntry(entry.handle)) return `fsa:${entry.id}`;
        if (entries.length < 64) break;
        cursor = entries.at(-1)!.id;
      }
      const id = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put({ id, handle });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      return `fsa:${id}`;
    } finally { db.close(); }
  });
}
