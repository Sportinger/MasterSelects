import { STORES } from './stores';
import { requestResult, requestSuccess } from './transactions';
import type { ProjectDbLogger } from './types';
import { resolveProjectRootMode } from '../project/core/projectRootAccess';
import { readLastOpfsProjectName } from '../project/tabProjectPersistence';

function isOpfsProjectDirectoryKey(key: string): boolean {
  return resolveProjectRootMode() === 'opfs' && (
    key === 'projectsFolder' || key === 'lastProject'
    || key.startsWith('lastProject:') || key.startsWith('recentProject:')
  );
}

// Store a FileSystemHandle (directory or file).
//
// Caching handles only saves re-acquiring access later, so a browser that
// cannot serialise them must not fail the operation that triggered the
// write. WebKit rejects FileSystemHandle in IndexedDB with DataCloneError;
// its handles are re-derivable by path, which is what callers fall back to.
export async function storeHandle(
  db: IDBDatabase,
  log: ProjectDbLogger,
  key: string,
  handle: FileSystemHandle,
): Promise<void> {
  // Chromium can terminate its browser process while deserializing OPFS
  // directory handles. Project names/paths already provide their restore path.
  if (isOpfsProjectDirectoryKey(key)) return;
  try {
    const transaction = db.transaction(STORES.FS_HANDLES, 'readwrite');
    const store = transaction.objectStore(STORES.FS_HANDLES);
    const request = store.put({ key, handle });

    await requestSuccess(request);
    log.debug('Stored handle:', key);
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'DataCloneError') {
      log.debug('Handle caching unsupported in this browser, skipping:', key);
      return;
    }
    throw error;
  }
}

const HANDLE_PROBE_KEY = '__handle_persistence_probe__';

/**
 * Whether IndexedDB accepts this handle, i.e. whether a linked file can be found
 * again after a reload. WebKit throws DataCloneError synchronously from put();
 * the probe transaction is always aborted, so nothing is stored.
 */
export function canStoreHandle(db: IDBDatabase, handle: FileSystemHandle): boolean {
  const transaction = db.transaction(STORES.FS_HANDLES, 'readwrite');
  // The aborted request reports AbortError; it is expected and must not surface.
  transaction.onerror = (event) => event.preventDefault();
  try {
    const request = transaction.objectStore(STORES.FS_HANDLES).put({ key: HANDLE_PROBE_KEY, handle });
    request.onerror = (event) => event.preventDefault();
    return true;
  } catch (error) {
    // Checked by name: older WebKit DOMExceptions do not inherit from Error.
    if ((error as { name?: unknown } | null)?.name === 'DataCloneError') return false;
    throw error;
  } finally {
    try { transaction.abort(); } catch { /* already finished */ }
  }
}

// Get a stored FileSystemHandle
export async function getStoredHandle(db: IDBDatabase, key: string): Promise<FileSystemHandle | null> {
  // Skip legacy records before issuing get(): a JS catch cannot catch the crash.
  if (isOpfsProjectDirectoryKey(key)) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.FS_HANDLES, 'readonly');
    const store = transaction.objectStore(STORES.FS_HANDLES);
    const request = store.get(key);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result?.handle ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

// Delete a stored handle
export async function deleteHandle(db: IDBDatabase, key: string): Promise<void> {
  const transaction = db.transaction(STORES.FS_HANDLES, 'readwrite');
  const store = transaction.objectStore(STORES.FS_HANDLES);
  const request = store.delete(key);
  return requestSuccess(request);
}

// List all stored handle keys (for debugging)
export async function listHandleKeys(db: IDBDatabase): Promise<string[]> {
  const transaction = db.transaction(STORES.FS_HANDLES, 'readonly');
  const store = transaction.objectStore(STORES.FS_HANDLES);
  const request = store.getAllKeys();
  return requestResult(request) as Promise<string[]>;
}

// Get all stored handles
export async function getAllHandles(db: IDBDatabase): Promise<Array<{ key: string; handle: FileSystemHandle }>> {
  if (resolveProjectRootMode() === 'opfs') {
    const entries: Array<{ key: string; handle: FileSystemHandle }> = [];
    for (const key of await listHandleKeys(db)) {
      if (isOpfsProjectDirectoryKey(key)) continue;
      const handle = await getStoredHandle(db, key);
      if (handle) entries.push({ key, handle });
    }
    return entries;
  }
  const transaction = db.transaction(STORES.FS_HANDLES, 'readonly');
  const store = transaction.objectStore(STORES.FS_HANDLES);
  const request = store.getAll();
  const result = await requestResult(request);
  return result || [];
}

// Check if there's a stored last project handle (for determining if welcome overlay should show)
export async function hasLastProject(db: IDBDatabase): Promise<boolean> {
  if (resolveProjectRootMode() === 'opfs' && readLastOpfsProjectName()) return true;
  try {
    // Polling needs existence only. count() never deserializes a stored handle,
    // including OPFS records written by previous versions or another tab.
    const store = db.transaction(STORES.FS_HANDLES, 'readonly').objectStore(STORES.FS_HANDLES);
    return await requestResult(store.count('lastProject')) > 0;
  } catch {
    return false;
  }
}
