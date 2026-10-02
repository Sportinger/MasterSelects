/** Origin-local attestation supplements locks: a raw copy cannot later impersonate the known writer location. */
export type RepositoryLocationAttestation = 'same-location' | 'needs-copy-restore' | 'location-registry-unavailable';
export async function attestWritableRepositoryLocation(repositoryId: string, locationId: string): Promise<RepositoryLocationAttestation> {
  if (!globalThis.indexedDB) return 'location-registry-unavailable';
  let db: IDBDatabase | undefined;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ms-repository-identity-locations', 1); let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('repositories', { keyPath: 'repositoryId' });
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); }; request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Repository identity registry is blocked')); };
    });
    return await new Promise<RepositoryLocationAttestation>((resolve, reject) => {
      const transaction = db!.transaction('repositories', 'readwrite');
      const store = transaction.objectStore('repositories');
      const request = store.get(repositoryId);
      let classification: RepositoryLocationAttestation = 'same-location';
      request.onsuccess = () => {
        const existing = request.result as { repositoryId: string; locationId: string } | undefined;
        if (existing && existing.locationId !== locationId) classification = 'needs-copy-restore';
        else if (!existing) store.add({ repositoryId, locationId });
      };
      transaction.oncomplete = () => resolve(classification);
      transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } catch { return 'location-registry-unavailable'; }
  finally { db?.close(); }
}
