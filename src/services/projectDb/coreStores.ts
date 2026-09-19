import { STORES } from './stores';
import { requestResult, requestSuccess, transactionSuccess } from './transactions';
import type { StoredMediaFile, StoredProject, ProjectDbLogger } from './types';

// Store a media file blob
export async function saveMediaFile(db: IDBDatabase, file: StoredMediaFile): Promise<void> {
  const transaction = db.transaction(STORES.MEDIA_FILES, 'readwrite');
  const store = transaction.objectStore(STORES.MEDIA_FILES);
  const request = store.put(file);
  return requestSuccess(request);
}

// Get a media file by ID
export async function getMediaFile(db: IDBDatabase, id: string): Promise<StoredMediaFile | undefined> {
  const transaction = db.transaction(STORES.MEDIA_FILES, 'readonly');
  const store = transaction.objectStore(STORES.MEDIA_FILES);
  const request = store.get(id);
  return requestResult(request);
}

// Get all media files
export async function getAllMediaFiles(db: IDBDatabase): Promise<StoredMediaFile[]> {
  const transaction = db.transaction(STORES.MEDIA_FILES, 'readonly');
  const store = transaction.objectStore(STORES.MEDIA_FILES);
  const request = store.getAll();
  return requestResult(request);
}

// Delete a media file
export async function deleteMediaFile(db: IDBDatabase, id: string): Promise<void> {
  const transaction = db.transaction(STORES.MEDIA_FILES, 'readwrite');
  const store = transaction.objectStore(STORES.MEDIA_FILES);
  const request = store.delete(id);
  return requestSuccess(request);
}

// Save a project
export async function saveProject(db: IDBDatabase, project: StoredProject): Promise<void> {
  const transaction = db.transaction(STORES.PROJECTS, 'readwrite');
  const store = transaction.objectStore(STORES.PROJECTS);
  const request = store.put(project);
  return requestSuccess(request);
}

// Get a project by ID
export async function getProject(db: IDBDatabase, id: string): Promise<StoredProject | undefined> {
  const transaction = db.transaction(STORES.PROJECTS, 'readonly');
  const store = transaction.objectStore(STORES.PROJECTS);
  const request = store.get(id);
  return requestResult(request);
}

// Get all projects (metadata only, not full data)
export async function getAllProjects(db: IDBDatabase): Promise<StoredProject[]> {
  const transaction = db.transaction(STORES.PROJECTS, 'readonly');
  const store = transaction.objectStore(STORES.PROJECTS);
  const request = store.getAll();
  return requestResult(request);
}

// Delete a project
export async function deleteProject(db: IDBDatabase, id: string): Promise<void> {
  const transaction = db.transaction(STORES.PROJECTS, 'readwrite');
  const store = transaction.objectStore(STORES.PROJECTS);
  const request = store.delete(id);
  return requestSuccess(request);
}

// Clear all data (for debugging/reset)
export async function clearAll(db: IDBDatabase, log: ProjectDbLogger): Promise<void> {
  const transaction = db.transaction([STORES.MEDIA_FILES, STORES.PROJECTS], 'readwrite');

  transaction.objectStore(STORES.MEDIA_FILES).clear();
  transaction.objectStore(STORES.PROJECTS).clear();

  await transactionSuccess(transaction);
  log.info('All data cleared');
}

// Get database stats
export async function getStats(
  db: IDBDatabase,
): Promise<{ mediaFiles: number; projects: number; proxyFrames: number }> {
  const transaction = db.transaction([STORES.MEDIA_FILES, STORES.PROJECTS, STORES.PROXY_FRAMES], 'readonly');

  const mediaRequest = transaction.objectStore(STORES.MEDIA_FILES).count();
  const projectRequest = transaction.objectStore(STORES.PROJECTS).count();
  const proxyRequest = transaction.objectStore(STORES.PROXY_FRAMES).count();

  let mediaCount = 0;
  let projectCount = 0;
  let proxyCount = 0;

  mediaRequest.onsuccess = () => { mediaCount = mediaRequest.result; };
  projectRequest.onsuccess = () => { projectCount = projectRequest.result; };
  proxyRequest.onsuccess = () => { proxyCount = proxyRequest.result; };

  await transactionSuccess(transaction);
  return { mediaFiles: mediaCount, projects: projectCount, proxyFrames: proxyCount };
}
