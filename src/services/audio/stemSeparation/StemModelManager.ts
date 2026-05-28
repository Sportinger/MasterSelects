import { Logger } from '../../logger';
import {
  DEFAULT_STEM_MODEL_ID,
  getStemModelTotalBytes,
  requireStemModel,
  STEM_MODEL_CATALOG,
} from './modelCatalog';
import type {
  StemModelCacheFileStatus,
  StemModelCacheStatus,
  StemModelCatalogEntry,
  StemModelDownloadProgress,
  StemModelFile,
  StemModelFileBuffer,
} from './types';

const log = Logger.create('StemModelManager');

const STEM_MODEL_CACHE_DIR = 'stem-separation-models';
const CACHE_METADATA_FILE = 'cache-metadata.json';
const CACHE_METADATA_SCHEMA_VERSION = 1;

interface StemModelCacheMetadata {
  schemaVersion: typeof CACHE_METADATA_SCHEMA_VERSION;
  modelId: string;
  modelVersion: string;
  downloadedAt: string;
  files: Record<string, {
    sizeBytes: number;
    url: string;
  }>;
}

interface StemModelManagerStorage {
  getDirectory: () => Promise<FileSystemDirectoryHandle>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

export interface StemModelManagerOptions {
  catalog?: readonly StemModelCatalogEntry[];
  fetchImpl?: typeof fetch;
  storage?: StemModelManagerStorage;
  now?: () => string;
}

export interface EnsureStemModelCachedOptions {
  signal?: AbortSignal;
  onProgress?: (progress: StemModelDownloadProgress) => void;
}

function abortError(): Error {
  const error = new Error('Stem model download was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : abortError();
  }
}

function normalizeArrayBuffer(value: ArrayBuffer | SharedArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  return new Uint8Array(value).slice().buffer;
}

async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

function createMetadata(model: StemModelCatalogEntry, now: () => string): StemModelCacheMetadata {
  return {
    schemaVersion: CACHE_METADATA_SCHEMA_VERSION,
    modelId: model.id,
    modelVersion: model.modelVersion,
    downloadedAt: now(),
    files: Object.fromEntries(model.files.map((file) => [
      file.name,
      {
        sizeBytes: file.sizeBytes,
        url: file.url,
      },
    ])),
  };
}

function isExpectedMetadata(
  metadata: StemModelCacheMetadata | null,
  model: StemModelCatalogEntry,
): boolean {
  return metadata?.schemaVersion === CACHE_METADATA_SCHEMA_VERSION
    && metadata.modelId === model.id
    && metadata.modelVersion === model.modelVersion;
}

export class StemModelManager {
  private readonly catalog: readonly StemModelCatalogEntry[];
  private readonly fetchImpl: typeof fetch;
  private readonly storage?: StemModelManagerStorage;
  private readonly now: () => string;
  private opfsRoot: FileSystemDirectoryHandle | null = null;
  private cacheRoot: FileSystemDirectoryHandle | null = null;
  private readonly modelDirs = new Map<string, FileSystemDirectoryHandle>();

  constructor(options: StemModelManagerOptions = {}) {
    this.catalog = options.catalog ?? STEM_MODEL_CATALOG;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getCacheStatus(modelId = DEFAULT_STEM_MODEL_ID): Promise<StemModelCacheStatus> {
    const model = this.requireModel(modelId);
    const expectedBytes = getStemModelTotalBytes(model);
    const dir = await this.getModelDir(model.id, true);
    const metadata = await this.readMetadata(dir);
    const metadataValid = isExpectedMetadata(metadata, model);
    const files = await Promise.all(model.files.map((file) => this.getFileStatus(file, dir, metadataValid)));
    const actualBytes = files.reduce((sum, file) => sum + (file.actualBytes ?? 0), 0);
    const persistent = await this.getPersistedStatus();

    return {
      modelId: model.id,
      modelVersion: model.modelVersion,
      cached: files.length > 0 && files.every((file) => file.valid),
      persistent,
      expectedBytes,
      actualBytes,
      files,
    };
  }

  async isModelCached(modelId = DEFAULT_STEM_MODEL_ID): Promise<boolean> {
    return (await this.getCacheStatus(modelId)).cached;
  }

  async ensureModelCached(
    modelId = DEFAULT_STEM_MODEL_ID,
    options: EnsureStemModelCachedOptions = {},
  ): Promise<StemModelCacheStatus> {
    const model = this.requireModel(modelId);
    if (model.files.length === 0) {
      throw new Error(`Stem separation model ${model.id} does not define downloadable files.`);
    }

    throwIfAborted(options.signal);
    await this.requestPersistentStorage();

    const initialStatus = await this.getCacheStatus(model.id);
    if (initialStatus.cached) {
      return initialStatus;
    }

    const dir = await this.getModelDir(model.id, true);
    const invalidNames = new Set(initialStatus.files
      .filter((file) => !file.valid)
      .map((file) => file.name));
    const filesToDownload = model.files.filter((file) => invalidNames.has(file.name));
    const totalBytes = filesToDownload.reduce((sum, file) => sum + file.sizeBytes, 0);
    let completedBytes = 0;

    for (const file of filesToDownload) {
      throwIfAborted(options.signal);
      const downloadedBytes = await this.downloadFile(file, model, dir, {
        signal: options.signal,
        onProgress: (downloadedBytesForFile) => {
          options.onProgress?.({
            modelId: model.id,
            fileName: file.name,
            downloadedBytes: downloadedBytesForFile,
            totalFileBytes: file.sizeBytes,
            overallDownloadedBytes: completedBytes + downloadedBytesForFile,
            overallTotalBytes: totalBytes,
            progress: totalBytes > 0
              ? Math.min(1, (completedBytes + downloadedBytesForFile) / totalBytes)
              : 1,
          });
        },
      });
      completedBytes += downloadedBytes;
    }

    await this.writeMetadata(dir, createMetadata(model, this.now));
    const finalStatus = await this.getCacheStatus(model.id);
    if (!finalStatus.cached) {
      throw new Error(`Stem separation model ${model.id} cache validation failed after download.`);
    }

    return finalStatus;
  }

  async loadModelBuffers(modelId = DEFAULT_STEM_MODEL_ID): Promise<StemModelFileBuffer[]> {
    const model = this.requireModel(modelId);
    const status = await this.getCacheStatus(model.id);
    if (!status.cached) {
      throw new Error(`Stem separation model ${model.id} is not cached.`);
    }

    const dir = await this.getModelDir(model.id, false);
    return Promise.all(model.files.map(async (file) => {
      const fileHandle = await dir.getFileHandle(file.name);
      const cachedFile = await fileHandle.getFile();
      return {
        name: file.name,
        buffer: normalizeArrayBuffer(await cachedFile.arrayBuffer()),
      };
    }));
  }

  async clearModelCache(modelId = DEFAULT_STEM_MODEL_ID): Promise<void> {
    const model = this.requireModel(modelId);
    const root = await this.getCacheRoot();
    try {
      await root.removeEntry(model.id, { recursive: true });
    } catch (error) {
      log.warn('Failed to clear stem model cache', { modelId: model.id, error });
    } finally {
      this.modelDirs.delete(model.id);
      this.cacheRoot = null;
      this.opfsRoot = null;
    }
  }

  async clearAllModelCaches(): Promise<void> {
    const root = await this.getOPFSRoot();
    try {
      await root.removeEntry(STEM_MODEL_CACHE_DIR, { recursive: true });
      this.cacheRoot = null;
      this.modelDirs.clear();
    } catch (error) {
      log.warn('Failed to clear all stem model caches', error);
    }
  }

  private requireModel(modelId: string): StemModelCatalogEntry {
    const model = this.catalog.find((candidate) => candidate.id === modelId);
    if (!model) {
      return requireStemModel(modelId);
    }
    return model;
  }

  private async getStorage(): Promise<StemModelManagerStorage> {
    const storage = this.storage ?? globalThis.navigator?.storage;
    if (!storage?.getDirectory) {
      throw new Error('OPFS storage is not available for stem separation models.');
    }
    return storage;
  }

  private async getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsRoot) {
      this.opfsRoot = await (await this.getStorage()).getDirectory();
    }
    return this.opfsRoot;
  }

  private async getCacheRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.cacheRoot) {
      this.cacheRoot = await (await this.getOPFSRoot()).getDirectoryHandle(STEM_MODEL_CACHE_DIR, { create: true });
    }
    return this.cacheRoot;
  }

  private async getModelDir(modelId: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const cached = this.modelDirs.get(modelId);
    if (cached) {
      return cached;
    }

    const root = await this.getCacheRoot();
    const dir = await root.getDirectoryHandle(modelId, { create });
    this.modelDirs.set(modelId, dir);
    return dir;
  }

  private async requestPersistentStorage(): Promise<boolean | undefined> {
    const storage = await this.getStorage();
    if (!storage.persist) {
      return undefined;
    }

    const persistent = await storage.persist();
    log.info(`Stem model storage persistence: ${persistent ? 'granted' : 'denied'}`);
    return persistent;
  }

  private async getPersistedStatus(): Promise<boolean | undefined> {
    const storage = await this.getStorage();
    return storage.persisted?.();
  }

  private async readMetadata(dir: FileSystemDirectoryHandle): Promise<StemModelCacheMetadata | null> {
    try {
      const handle = await dir.getFileHandle(CACHE_METADATA_FILE);
      const file = await handle.getFile();
      return JSON.parse(await blobText(file)) as StemModelCacheMetadata;
    } catch {
      return null;
    }
  }

  private async writeMetadata(
    dir: FileSystemDirectoryHandle,
    metadata: StemModelCacheMetadata,
  ): Promise<void> {
    const handle = await dir.getFileHandle(CACHE_METADATA_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(metadata));
    await writable.close();
  }

  private async getFileStatus(
    file: StemModelFile,
    dir: FileSystemDirectoryHandle,
    metadataValid: boolean,
  ): Promise<StemModelCacheFileStatus> {
    try {
      const handle = await dir.getFileHandle(file.name);
      const cachedFile = await handle.getFile();
      if (cachedFile.size !== file.sizeBytes) {
        return {
          name: file.name,
          url: file.url,
          expectedBytes: file.sizeBytes,
          actualBytes: cachedFile.size,
          cached: true,
          valid: false,
          reason: 'size-mismatch',
        };
      }
      if (!metadataValid) {
        return {
          name: file.name,
          url: file.url,
          expectedBytes: file.sizeBytes,
          actualBytes: cachedFile.size,
          cached: true,
          valid: false,
          reason: 'metadata-missing',
        };
      }
      return {
        name: file.name,
        url: file.url,
        expectedBytes: file.sizeBytes,
        actualBytes: cachedFile.size,
        cached: true,
        valid: true,
      };
    } catch {
      return {
        name: file.name,
        url: file.url,
        expectedBytes: file.sizeBytes,
        cached: false,
        valid: false,
        reason: 'missing',
      };
    }
  }

  private async downloadFile(
    file: StemModelFile,
    model: StemModelCatalogEntry,
    dir: FileSystemDirectoryHandle,
    options: {
      signal?: AbortSignal;
      onProgress: (downloadedBytes: number) => void;
    },
  ): Promise<number> {
    log.info(`Downloading stem model file ${file.name}`, { modelId: model.id, sizeBytes: file.sizeBytes });
    throwIfAborted(options.signal);

    const response = await this.fetchImpl(file.url, {
      signal: options.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Failed to download ${file.name}: HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error(`Failed to download ${file.name}: streaming response body is unavailable.`);
    }

    const handle = await dir.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    const reader = response.body.getReader();
    let downloadedBytes = 0;
    let closed = false;

    try {
      while (true) {
        throwIfAborted(options.signal);
        const { done, value } = await reader.read();
        throwIfAborted(options.signal);
        if (done) {
          break;
        }
        await writable.write(value);
        downloadedBytes += value.byteLength;
        options.onProgress(downloadedBytes);
      }

      await writable.close();
      closed = true;
    } catch (error) {
      try {
        if (!closed && 'abort' in writable && typeof writable.abort === 'function') {
          await writable.abort();
        }
      } catch {
        // Ignore cleanup failures and rethrow the original error.
      }
      try {
        await dir.removeEntry(file.name);
      } catch {
        // Missing partial files are fine after a cancelled or failed download.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    if (downloadedBytes !== file.sizeBytes) {
      try {
        await dir.removeEntry(file.name);
      } catch {
        // Ignore cleanup failures after a size mismatch.
      }
      throw new Error(`Downloaded ${file.name} size mismatch: expected ${file.sizeBytes}, got ${downloadedBytes}.`);
    }

    log.info(`Downloaded stem model file ${file.name}`, { modelId: model.id, downloadedBytes });
    return downloadedBytes;
  }
}

let instance: StemModelManager | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    instance = null;
  });
}

export function getStemModelManager(): StemModelManager {
  if (!instance) {
    instance = new StemModelManager();
  }
  return instance;
}
