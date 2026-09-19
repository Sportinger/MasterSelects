import { STORES } from './stores';
import { requestResult, requestSuccess, transactionSuccess } from './transactions';
import type { StoredSourceThumbnail, StoredThumbnail } from './types';

// Save thumbnail by file hash
export async function saveThumbnail(db: IDBDatabase, thumbnail: StoredThumbnail): Promise<void> {
  const transaction = db.transaction(STORES.THUMBNAILS, 'readwrite');
  const store = transaction.objectStore(STORES.THUMBNAILS);
  const request = store.put(thumbnail);
  return requestSuccess(request);
}

// Get thumbnail by file hash
export async function getThumbnail(db: IDBDatabase, fileHash: string): Promise<StoredThumbnail | undefined> {
  const transaction = db.transaction(STORES.THUMBNAILS, 'readonly');
  const store = transaction.objectStore(STORES.THUMBNAILS);
  const request = store.get(fileHash);
  return requestResult(request);
}

// Check if thumbnail exists by hash
export async function hasThumbnail(db: IDBDatabase, fileHash: string): Promise<boolean> {
  const thumbnail = await getThumbnail(db, fileHash);
  return !!thumbnail;
}

// Delete thumbnail by file hash
export async function deleteThumbnail(db: IDBDatabase, fileHash: string): Promise<void> {
  const transaction = db.transaction(STORES.THUMBNAILS, 'readwrite');
  const store = transaction.objectStore(STORES.THUMBNAILS);
  const request = store.delete(fileHash);
  return requestSuccess(request);
}

/** Save a batch of source thumbnails */
export async function saveSourceThumbnailsBatch(
  db: IDBDatabase,
  frames: StoredSourceThumbnail[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SOURCE_THUMBNAILS, 'readwrite');
    const store = transaction.objectStore(STORES.SOURCE_THUMBNAILS);

    for (const frame of frames) {
      store.put(frame);
    }

    void transactionSuccess(transaction).then(resolve, reject);
  });
}

/** Get all source thumbnails for a media file */
export async function getSourceThumbnails(db: IDBDatabase, mediaFileId: string): Promise<StoredSourceThumbnail[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SOURCE_THUMBNAILS, 'readonly');
    const store = transaction.objectStore(STORES.SOURCE_THUMBNAILS);
    try {
      const index = store.index('mediaFileId');
      const request = index.getAll(mediaFileId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    } catch {
      resolve([]);
    }
  });
}

/** Get source thumbnails by file hash (for deduplication) */
export async function getSourceThumbnailsByHash(
  db: IDBDatabase,
  fileHash: string,
): Promise<StoredSourceThumbnail[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SOURCE_THUMBNAILS, 'readonly');
    const store = transaction.objectStore(STORES.SOURCE_THUMBNAILS);
    try {
      const index = store.index('fileHash');
      const request = index.getAll(fileHash);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    } catch {
      resolve([]);
    }
  });
}

/** Delete all source thumbnails for a media file */
export async function deleteSourceThumbnails(db: IDBDatabase, mediaFileId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.SOURCE_THUMBNAILS, 'readwrite');
    const store = transaction.objectStore(STORES.SOURCE_THUMBNAILS);
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

/** Clear all source thumbnails */
export async function clearAllSourceThumbnails(db: IDBDatabase): Promise<void> {
  const transaction = db.transaction(STORES.SOURCE_THUMBNAILS, 'readwrite');
  const store = transaction.objectStore(STORES.SOURCE_THUMBNAILS);
  const request = store.clear();
  return requestSuccess(request);
}
