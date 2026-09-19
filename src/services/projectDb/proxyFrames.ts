import { STORES } from './stores';
import { requestResult, requestSuccess, transactionSuccess } from './transactions';
import type { StoredProxyFrame } from './types';

// Save a single proxy frame
export async function saveProxyFrame(db: IDBDatabase, frame: StoredProxyFrame): Promise<void> {
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readwrite');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const request = store.put(frame);
  return requestSuccess(request);
}

// Save multiple proxy frames in a batch (more efficient)
export async function saveProxyFramesBatch(db: IDBDatabase, frames: StoredProxyFrame[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.PROXY_FRAMES, 'readwrite');
    const store = transaction.objectStore(STORES.PROXY_FRAMES);

    for (const frame of frames) {
      store.put(frame);
    }

    void transactionSuccess(transaction).then(resolve, reject);
  });
}

// Get a specific proxy frame
export async function getProxyFrame(
  db: IDBDatabase,
  mediaFileId: string,
  frameIndex: number,
): Promise<StoredProxyFrame | undefined> {
  const id = `${mediaFileId}_${frameIndex.toString().padStart(6, '0')}`;
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const request = store.get(id);
  return requestResult(request);
}

// Get all proxy frames for a media file
export async function getProxyFramesForMedia(db: IDBDatabase, mediaFileId: string): Promise<StoredProxyFrame[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
    const store = transaction.objectStore(STORES.PROXY_FRAMES);
    const index = store.index('mediaFileId');
    const request = index.getAll(mediaFileId);

    request.onsuccess = () => {
      // Sort by frame index
      const frames = request.result.sort((a, b) => a.frameIndex - b.frameIndex);
      resolve(frames);
    };
    request.onerror = () => reject(request.error);
  });
}

// Check if proxy exists for a media file
export async function hasProxy(db: IDBDatabase, mediaFileId: string): Promise<boolean> {
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const index = store.index('mediaFileId');
  const request = index.count(mediaFileId);
  const count = await requestResult(request);
  return count > 0;
}

// Get proxy frame count for a media file
export async function getProxyFrameCount(db: IDBDatabase, mediaFileId: string): Promise<number> {
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const index = store.index('mediaFileId');
  const request = index.count(mediaFileId);
  return requestResult(request);
}

// Delete all proxy frames for a media file
export async function deleteProxyFrames(db: IDBDatabase, mediaFileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.PROXY_FRAMES, 'readwrite');
    const store = transaction.objectStore(STORES.PROXY_FRAMES);
    const index = store.index('mediaFileId');
    const request = index.openCursor(mediaFileId);

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    void transactionSuccess(transaction).then(resolve, reject);
  });
}

// Clear all proxy frames (for all media)
export async function clearAllProxyFrames(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readwrite');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const request = store.clear();
  return requestSuccess(request);
}

// Get proxy frame count by file hash (for deduplication)
export async function getProxyFrameCountByHash(db: IDBDatabase, fileHash: string): Promise<number> {
  return new Promise((resolve, _reject) => {
    const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
    const store = transaction.objectStore(STORES.PROXY_FRAMES);
    try {
      const index = store.index('fileHash');
      const request = index.count(fileHash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0); // Fallback if index doesn't exist
    } catch {
      resolve(0); // Index doesn't exist yet
    }
  });
}

// Get a proxy frame by file hash
export async function getProxyFrameByHash(
  db: IDBDatabase,
  fileHash: string,
  frameIndex: number,
): Promise<StoredProxyFrame | undefined> {
  const id = `${fileHash}_${frameIndex.toString().padStart(6, '0')}`;
  const transaction = db.transaction(STORES.PROXY_FRAMES, 'readonly');
  const store = transaction.objectStore(STORES.PROXY_FRAMES);
  const request = store.get(id);
  return requestResult(request);
}

// Check if proxy exists by file hash
export async function hasProxyByHash(db: IDBDatabase, fileHash: string): Promise<boolean> {
  const count = await getProxyFrameCountByHash(db, fileHash);
  return count > 0;
}
