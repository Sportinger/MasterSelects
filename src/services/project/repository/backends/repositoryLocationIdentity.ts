/** Origin-local attestation supplements locks: a raw copy cannot later impersonate the known writer location. */
export type RepositoryLocationAttestation = 'same-location' | 'needs-copy-restore' | 'location-registry-unavailable';

interface LocationRecord { repositoryId: string; locationId: string }

/**
 * Browser-local projects live in OPFS ('opfs:<origin>:<path>') or, when the browser
 * refuses OPFS, in the IndexedDB fallback ('indexeddb:<origin>:<path>'). The same
 * folder in the other store is the same project after the app moved it between
 * stores, never a foreign copy; one writer per repository is still enforced by locks.
 */
function browserFolderOf(locationId: string): string | null {
  const match = /^(?:opfs|indexeddb):(.+)$/.exec(locationId);
  return match ? match[1] : null;
}

export function isBrowserStorageMove(knownLocationId: string, locationId: string): boolean {
  const folder = browserFolderOf(locationId);
  return folder !== null && knownLocationId !== locationId && browserFolderOf(knownLocationId) === folder;
}

function openRegistry(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ms-repository-identity-locations', 1); let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('repositories', { keyPath: 'repositoryId' });
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); }; request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Repository identity registry is blocked')); };
  });
}

function update<T>(db: IDBDatabase, repositoryId: string, decide: (existing: LocationRecord | undefined, store: IDBObjectStore) => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('repositories', 'readwrite');
    const store = transaction.objectStore('repositories');
    const request = store.get(repositoryId);
    let result!: T;
    request.onsuccess = () => { result = decide(request.result as LocationRecord | undefined, store); };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}

export async function attestWritableRepositoryLocation(repositoryId: string, locationId: string): Promise<RepositoryLocationAttestation> {
  if (!globalThis.indexedDB) return 'location-registry-unavailable';
  let db: IDBDatabase | undefined;
  try {
    db = await openRegistry();
    return await update<RepositoryLocationAttestation>(db, repositoryId, (existing, store) => {
      if (!existing) { store.add({ repositoryId, locationId }); return 'same-location'; }
      if (existing.locationId === locationId) return 'same-location';
      if (isBrowserStorageMove(existing.locationId, locationId)) { store.put({ repositoryId, locationId }); return 'same-location'; }
      return 'needs-copy-restore';
    });
  } catch { return 'location-registry-unavailable'; }
  finally { db?.close(); }
}

/**
 * Hands the writer identity to the verified copy of a project the app itself moved
 * (e.g. from the IndexedDB fallback into OPFS under a free folder name). Only the
 * registered source location may hand over; an unregistered repository is registered.
 */
export async function moveRepositoryLocationIdentity(repositoryId: string, fromLocationId: string, toLocationId: string): Promise<boolean> {
  if (!globalThis.indexedDB) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await openRegistry();
    return await update(db, repositoryId, (existing, store) => {
      if (existing && existing.locationId !== fromLocationId && existing.locationId !== toLocationId) return false;
      store.put({ repositoryId, locationId: toLocationId }); return true;
    });
  } catch { return false; }
  finally { db?.close(); }
}
