import type { ArtifactManifest } from '../../artifacts/types';
import { STORES } from './stores';
import { requestSuccess, transactionSuccess } from './transactions';
import type { StoredArtifactBlob, StoredArtifactManifest } from './types';

export async function saveArtifactManifest(db: IDBDatabase, manifest: ArtifactManifest): Promise<void> {
  const record: StoredArtifactManifest = {
    artifactId: manifest.artifactId,
    hash: manifest.hash,
    sourceRefs: manifest.sourceRefs,
    manifest,
    updatedAt: Date.now(),
  };

  const transaction = db.transaction(STORES.ARTIFACTS, 'readwrite');
  const store = transaction.objectStore(STORES.ARTIFACTS);
  const request = store.put(record);
  return requestSuccess(request);
}

export async function saveArtifact(db: IDBDatabase, manifest: ArtifactManifest, blob: Blob): Promise<void> {
  const now = Date.now();
  const manifestRecord: StoredArtifactManifest = {
    artifactId: manifest.artifactId,
    hash: manifest.hash,
    sourceRefs: manifest.sourceRefs,
    manifest,
    updatedAt: now,
  };
  const blobRecord: StoredArtifactBlob = {
    hash: manifest.hash,
    artifactId: manifest.artifactId,
    blob,
    updatedAt: now,
  };

  const transaction = db.transaction([STORES.ARTIFACTS, STORES.ARTIFACT_BLOBS], 'readwrite');
  transaction.objectStore(STORES.ARTIFACTS).put(manifestRecord);
  transaction.objectStore(STORES.ARTIFACT_BLOBS).put(blobRecord);

  return new Promise((resolve, reject) => {
    void transactionSuccess(transaction).then(resolve, reject);
  });
}

export async function getArtifactManifest(
  db: IDBDatabase,
  artifactId: string,
): Promise<ArtifactManifest | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.ARTIFACTS, 'readonly');
    const store = transaction.objectStore(STORES.ARTIFACTS);
    const request = store.get(artifactId);

    request.onsuccess = () => {
      const record = request.result as StoredArtifactManifest | undefined;
      resolve(record?.manifest);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listArtifactManifests(db: IDBDatabase): Promise<ArtifactManifest[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.ARTIFACTS, 'readonly');
    const store = transaction.objectStore(STORES.ARTIFACTS);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result as StoredArtifactManifest[];
      resolve(records.map((record) => record.manifest));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function listArtifactManifestsBySource(
  db: IDBDatabase,
  sourceRef: string,
): Promise<ArtifactManifest[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.ARTIFACTS, 'readonly');
    const store = transaction.objectStore(STORES.ARTIFACTS);

    try {
      const index = store.index('sourceRefs');
      const request = index.getAll(sourceRef);
      request.onsuccess = () => {
        const records = request.result as StoredArtifactManifest[];
        resolve(records.map((record) => record.manifest));
      };
      request.onerror = () => reject(request.error);
    } catch {
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result as StoredArtifactManifest[];
        resolve(records
          .filter((record) => record.sourceRefs.includes(sourceRef))
          .map((record) => record.manifest));
      };
      request.onerror = () => reject(request.error);
    }
  });
}

export async function deleteArtifactManifest(db: IDBDatabase, artifactId: string): Promise<void> {
  const transaction = db.transaction(STORES.ARTIFACTS, 'readwrite');
  const store = transaction.objectStore(STORES.ARTIFACTS);
  const request = store.delete(artifactId);
  return requestSuccess(request);
}

export async function getArtifactBlob(db: IDBDatabase, hash: string): Promise<Blob | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.ARTIFACT_BLOBS, 'readonly');
    const store = transaction.objectStore(STORES.ARTIFACT_BLOBS);
    const request = store.get(hash);

    request.onsuccess = () => {
      const record = request.result as StoredArtifactBlob | undefined;
      resolve(record?.blob);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteArtifactBlob(db: IDBDatabase, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORES.ARTIFACT_BLOBS, 'readwrite');
    const store = transaction.objectStore(STORES.ARTIFACT_BLOBS);
    const getRequest = store.get(hash);

    getRequest.onsuccess = () => {
      if (!getRequest.result) {
        resolve(false);
        return;
      }

      const deleteRequest = store.delete(hash);
      deleteRequest.onsuccess = () => resolve(true);
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}
