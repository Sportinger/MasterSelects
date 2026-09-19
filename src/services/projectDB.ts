// IndexedDB service for project persistence
// Stores media file blobs and project data

import type { ArtifactManifest } from '../artifacts/types';
import { Logger } from './logger';
import * as analysisCache from './projectDb/analysisCache';
import * as artifactStores from './projectDb/artifacts';
import * as coreStores from './projectDb/coreStores';
import * as handleStores from './projectDb/handles';
import * as proxyFrameStores from './projectDb/proxyFrames';
import { openDatabase } from './projectDb/openDatabase';
import { STORES } from './projectDb/stores';
import * as thumbnailStores from './projectDb/thumbnails';
import type {
  StoredAnalysis,
  StoredMediaFile,
  StoredProject,
  StoredProxyFrame,
  StoredSourceThumbnail,
  StoredThumbnail,
} from './projectDb/types';

export type {
  ProxyMetadata,
  StoredAnalysis,
  StoredArtifactBlob,
  StoredArtifactManifest,
  StoredMediaFile,
  StoredProject,
  StoredProxyFrame,
  StoredSourceThumbnail,
  StoredThumbnail,
} from './projectDb/types';

const log = Logger.create('ProjectDB');

const INIT_RETRY_COOLDOWN_MS = 5_000;

const DB_NAME = 'MASterSelectsDB';
const DB_VERSION = 8; // Upgraded for content-addressed artifact manifests and blobs

class ProjectDatabase {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private initFailed = false;
  private initError: unknown = null;
  private retryInitAfter = 0;

  // Check if IndexedDB is available
  isAvailable(): boolean {
    return this.db !== null && !this.initFailed;
  }

  // Reset the init failure flag to allow retry
  resetInitFailure(): void {
    this.initFailed = false;
    this.initError = null;
    this.retryInitAfter = 0;
    log.info('IndexedDB init failure flag reset - will retry on next access');
  }

  // Check if init has failed (for UI to show retry option)
  hasInitFailed(): boolean {
    return this.initFailed;
  }

  // Initialize the database
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;
    if (this.initFailed && Date.now() < this.retryInitAfter) throw this.initError;

    this.initPromise = this.openDatabase()
      .catch((error: unknown) => {
        // WebKit can abort an open while resuming storage. Retry only that
        // transient failure, once, before surfacing it to all shared callers.
        if (error instanceof DOMException && error.name === 'AbortError') {
          return this.openDatabase();
        }
        throw error;
      })
      .catch((error: unknown) => {
        this.initFailed = true;
        this.initError = error;
        this.retryInitAfter = Date.now() + INIT_RETRY_COOLDOWN_MS;
        log.error('Failed to open IndexedDB', error);
        throw error;
      })
      .finally(() => { this.initPromise = null; });
    return this.initPromise;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return openDatabase(DB_NAME, DB_VERSION, (db, event, transaction) => {
      // Create media files store
      if (!db.objectStoreNames.contains(STORES.MEDIA_FILES)) {
        const mediaStore = db.createObjectStore(STORES.MEDIA_FILES, { keyPath: 'id' });
        mediaStore.createIndex('name', 'name', { unique: false });
        mediaStore.createIndex('type', 'type', { unique: false });
      }

      // Create projects store
      if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
        const projectStore = db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
        projectStore.createIndex('name', 'name', { unique: false });
        projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Create proxy frames store (new in v2)
      if (!db.objectStoreNames.contains(STORES.PROXY_FRAMES)) {
        const proxyStore = db.createObjectStore(STORES.PROXY_FRAMES, { keyPath: 'id' });
        proxyStore.createIndex('mediaFileId', 'mediaFileId', { unique: false });
        proxyStore.createIndex('frameIndex', 'frameIndex', { unique: false });
        proxyStore.createIndex('fileHash', 'fileHash', { unique: false });
      } else if (event.oldVersion < 5) {
        // Add fileHash index for proxy deduplication (v5)
        const proxyStore = transaction.objectStore(STORES.PROXY_FRAMES);
        if (!proxyStore.indexNames.contains('fileHash')) {
          proxyStore.createIndex('fileHash', 'fileHash', { unique: false });
        }
      }

      // Create file system handles store (new in v3)
      if (!db.objectStoreNames.contains(STORES.FS_HANDLES)) {
        db.createObjectStore(STORES.FS_HANDLES, { keyPath: 'key' });
      }

      // Create analysis cache store (new in v4)
      if (!db.objectStoreNames.contains(STORES.ANALYSIS_CACHE)) {
        db.createObjectStore(STORES.ANALYSIS_CACHE, { keyPath: 'mediaFileId' });
      }

      // Create thumbnails store for deduplication (new in v5)
      if (!db.objectStoreNames.contains(STORES.THUMBNAILS)) {
        db.createObjectStore(STORES.THUMBNAILS, { keyPath: 'fileHash' });
      }

      // Create source thumbnails store (new in v6)
      if (!db.objectStoreNames.contains(STORES.SOURCE_THUMBNAILS)) {
        const srcThumbStore = db.createObjectStore(STORES.SOURCE_THUMBNAILS, { keyPath: 'id' });
        srcThumbStore.createIndex('mediaFileId', 'mediaFileId', { unique: false });
        srcThumbStore.createIndex('fileHash', 'fileHash', { unique: false });
      }

      // Create artifact manifest index (new in v7)
      if (!db.objectStoreNames.contains(STORES.ARTIFACTS)) {
        const artifactStore = db.createObjectStore(STORES.ARTIFACTS, { keyPath: 'artifactId' });
        artifactStore.createIndex('hash', 'hash', { unique: false });
        artifactStore.createIndex('sourceRefs', 'sourceRefs', { unique: false, multiEntry: true });
        artifactStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else if (event.oldVersion < 7) {
        const artifactStore = transaction.objectStore(STORES.ARTIFACTS);
        if (!artifactStore.indexNames.contains('hash')) {
          artifactStore.createIndex('hash', 'hash', { unique: false });
        }
        if (!artifactStore.indexNames.contains('sourceRefs')) {
          artifactStore.createIndex('sourceRefs', 'sourceRefs', { unique: false, multiEntry: true });
        }
        if (!artifactStore.indexNames.contains('updatedAt')) {
          artifactStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }

      // Create artifact byte store (new in v8)
      if (!db.objectStoreNames.contains(STORES.ARTIFACT_BLOBS)) {
        const artifactBlobStore = db.createObjectStore(STORES.ARTIFACT_BLOBS, { keyPath: 'hash' });
        artifactBlobStore.createIndex('artifactId', 'artifactId', { unique: false });
        artifactBlobStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else if (event.oldVersion < 8) {
        const artifactBlobStore = transaction.objectStore(STORES.ARTIFACT_BLOBS);
        if (!artifactBlobStore.indexNames.contains('artifactId')) {
          artifactBlobStore.createIndex('artifactId', 'artifactId', { unique: false });
        }
        if (!artifactBlobStore.indexNames.contains('updatedAt')) {
          artifactBlobStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }

      log.info('Database schema created/upgraded');
    }).then(db => {
      this.db = db;
      const invalidate = () => {
        if (this.db !== db) return;
        this.db = null;
        this.initPromise = null;
        this.initFailed = false;
      };
      // WebKit may close storage connections when suspending a page. Never
      // return that stale connection to a later project operation.
      db.addEventListener('close', invalidate);
      db.addEventListener('versionchange', () => {
        db.close();
        invalidate();
      });
      this.initFailed = false;
      this.initError = null;
      this.retryInitAfter = 0;
      log.info('Database opened successfully');
      return db;
    });
  }

  // ============ Media Files ============

  async saveMediaFile(file: StoredMediaFile): Promise<void> {
    return coreStores.saveMediaFile(await this.init(), file);
  }

  async getMediaFile(id: string): Promise<StoredMediaFile | undefined> {
    return coreStores.getMediaFile(await this.init(), id);
  }

  async getAllMediaFiles(): Promise<StoredMediaFile[]> {
    return coreStores.getAllMediaFiles(await this.init());
  }

  async deleteMediaFile(id: string): Promise<void> {
    return coreStores.deleteMediaFile(await this.init(), id);
  }

  // ============ Projects ============

  async saveProject(project: StoredProject): Promise<void> {
    return coreStores.saveProject(await this.init(), project);
  }

  async getProject(id: string): Promise<StoredProject | undefined> {
    return coreStores.getProject(await this.init(), id);
  }

  async getAllProjects(): Promise<StoredProject[]> {
    return coreStores.getAllProjects(await this.init());
  }

  async deleteProject(id: string): Promise<void> {
    return coreStores.deleteProject(await this.init(), id);
  }

  // ============ Artifact Manifests ============

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    return artifactStores.saveArtifactManifest(await this.init(), manifest);
  }

  async saveArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    return artifactStores.saveArtifact(await this.init(), manifest, blob);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | undefined> {
    return artifactStores.getArtifactManifest(await this.init(), artifactId);
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    return artifactStores.listArtifactManifests(await this.init());
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return artifactStores.listArtifactManifestsBySource(await this.init(), sourceRef);
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    return artifactStores.deleteArtifactManifest(await this.init(), artifactId);
  }

  async getArtifactBlob(hash: string): Promise<Blob | undefined> {
    return artifactStores.getArtifactBlob(await this.init(), hash);
  }

  async deleteArtifactBlob(hash: string): Promise<boolean> {
    return artifactStores.deleteArtifactBlob(await this.init(), hash);
  }

  // ============ Utilities ============

  async clearAll(): Promise<void> {
    return coreStores.clearAll(await this.init(), log);
  }

  async getStats(): Promise<{ mediaFiles: number; projects: number; proxyFrames: number }> {
    return coreStores.getStats(await this.init());
  }

  // ============ Proxy Frames ============

  async saveProxyFrame(frame: StoredProxyFrame): Promise<void> {
    return proxyFrameStores.saveProxyFrame(await this.init(), frame);
  }

  async saveProxyFramesBatch(frames: StoredProxyFrame[]): Promise<void> {
    return proxyFrameStores.saveProxyFramesBatch(await this.init(), frames);
  }

  async getProxyFrame(mediaFileId: string, frameIndex: number): Promise<StoredProxyFrame | undefined> {
    return proxyFrameStores.getProxyFrame(await this.init(), mediaFileId, frameIndex);
  }

  async getProxyFramesForMedia(mediaFileId: string): Promise<StoredProxyFrame[]> {
    return proxyFrameStores.getProxyFramesForMedia(await this.init(), mediaFileId);
  }

  async hasProxy(mediaFileId: string): Promise<boolean> {
    return proxyFrameStores.hasProxy(await this.init(), mediaFileId);
  }

  async getProxyFrameCount(mediaFileId: string): Promise<number> {
    return proxyFrameStores.getProxyFrameCount(await this.init(), mediaFileId);
  }

  async deleteProxyFrames(mediaFileId: string): Promise<void> {
    return proxyFrameStores.deleteProxyFrames(await this.init(), mediaFileId);
  }

  async clearAllProxyFrames(): Promise<void> {
    return proxyFrameStores.clearAllProxyFrames(await this.init());
  }

  // ============ Hash-based Proxy Deduplication ============

  async getProxyFrameCountByHash(fileHash: string): Promise<number> {
    return proxyFrameStores.getProxyFrameCountByHash(await this.init(), fileHash);
  }

  async getProxyFrameByHash(fileHash: string, frameIndex: number): Promise<StoredProxyFrame | undefined> {
    return proxyFrameStores.getProxyFrameByHash(await this.init(), fileHash, frameIndex);
  }

  async hasProxyByHash(fileHash: string): Promise<boolean> {
    return proxyFrameStores.hasProxyByHash(await this.init(), fileHash);
  }

  // ============ Thumbnail Deduplication ============

  async saveThumbnail(thumbnail: StoredThumbnail): Promise<void> {
    return thumbnailStores.saveThumbnail(await this.init(), thumbnail);
  }

  async getThumbnail(fileHash: string): Promise<StoredThumbnail | undefined> {
    return thumbnailStores.getThumbnail(await this.init(), fileHash);
  }

  async hasThumbnail(fileHash: string): Promise<boolean> {
    return thumbnailStores.hasThumbnail(await this.init(), fileHash);
  }

  async deleteThumbnail(fileHash: string): Promise<void> {
    return thumbnailStores.deleteThumbnail(await this.init(), fileHash);
  }

  // ============ File System Handles ============

  async storeHandle(key: string, handle: FileSystemHandle): Promise<void> {
    return handleStores.storeHandle(await this.init(), log, key, handle);
  }

  async getStoredHandle(key: string): Promise<FileSystemHandle | null> {
    return handleStores.getStoredHandle(await this.init(), key);
  }

  async deleteHandle(key: string): Promise<void> {
    return handleStores.deleteHandle(await this.init(), key);
  }

  async listHandleKeys(): Promise<string[]> {
    return handleStores.listHandleKeys(await this.init());
  }

  async getAllHandles(): Promise<Array<{ key: string; handle: FileSystemHandle }>> {
    return handleStores.getAllHandles(await this.init());
  }

  async hasLastProject(): Promise<boolean> {
    try {
      return handleStores.hasLastProject(await this.init());
    } catch {
      return false;
    }
  }

  // ============ Analysis Cache ============

  async saveAnalysis(
    mediaFileId: string,
    inPoint: number,
    outPoint: number,
    frames: StoredAnalysis['analyses'][string]['frames'],
    sampleInterval: number
  ): Promise<void> {
    return analysisCache.saveAnalysis(await this.init(), log, mediaFileId, inPoint, outPoint, frames, sampleInterval);
  }

  async getAnalysis(
    mediaFileId: string,
    inPoint: number,
    outPoint: number
  ): Promise<StoredAnalysis['analyses'][string] | undefined> {
    return analysisCache.getAnalysis(await this.init(), mediaFileId, inPoint, outPoint);
  }

  async hasAnalysis(mediaFileId: string, inPoint: number, outPoint: number): Promise<boolean> {
    return analysisCache.hasAnalysis(await this.init(), mediaFileId, inPoint, outPoint);
  }

  async getAnalysisRanges(mediaFileId: string): Promise<string[]> {
    return analysisCache.getAnalysisRanges(await this.init(), mediaFileId);
  }

  async deleteAnalysis(mediaFileId: string): Promise<void> {
    return analysisCache.deleteAnalysis(await this.init(), mediaFileId);
  }

  async clearAllAnalysis(): Promise<void> {
    return analysisCache.clearAllAnalysis(await this.init(), log);
  }

  // ============ Source Thumbnails (1-per-second cache) ============

  async saveSourceThumbnailsBatch(frames: StoredSourceThumbnail[]): Promise<void> {
    return thumbnailStores.saveSourceThumbnailsBatch(await this.init(), frames);
  }

  async getSourceThumbnails(mediaFileId: string): Promise<StoredSourceThumbnail[]> {
    return thumbnailStores.getSourceThumbnails(await this.init(), mediaFileId);
  }

  async getSourceThumbnailsByHash(fileHash: string): Promise<StoredSourceThumbnail[]> {
    return thumbnailStores.getSourceThumbnailsByHash(await this.init(), fileHash);
  }

  async deleteSourceThumbnails(mediaFileId: string): Promise<void> {
    return thumbnailStores.deleteSourceThumbnails(await this.init(), mediaFileId);
  }

  async clearAllSourceThumbnails(): Promise<void> {
    return thumbnailStores.clearAllSourceThumbnails(await this.init());
  }
}

// Singleton instance
export const projectDB = new ProjectDatabase();
