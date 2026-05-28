import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STEM_MODEL_ID,
  getProductionStemModels,
  getStemModelById,
  StemModelManager,
  type StemModelCatalogEntry,
} from '../../../src/services/audio/stemSeparation';

class MemoryFileHandle {
  name: string;
  bytes = new Uint8Array();

  constructor(name: string) {
    this.name = name;
  }

  async getFile(): Promise<File> {
    const bytes = this.bytes.slice();
    return {
      name: this.name,
      size: bytes.byteLength,
      type: 'application/octet-stream',
      lastModified: 0,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    } as unknown as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: Uint8Array[] = [];
    return {
      write: async (chunk: BlobPart) => {
        if (chunk instanceof Blob) {
          chunks.push(new Uint8Array(await chunk.arrayBuffer()));
          return;
        }
        if (chunk instanceof ArrayBuffer) {
          chunks.push(new Uint8Array(chunk));
          return;
        }
        if (ArrayBuffer.isView(chunk)) {
          chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          return;
        }
        chunks.push(new TextEncoder().encode(String(chunk)));
      },
      close: async () => {
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const nextBytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          nextBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this.bytes = nextBytes;
      },
      abort: async () => {
        chunks.length = 0;
      },
      seek: async () => {},
      truncate: async () => {},
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing as unknown as FileSystemDirectoryHandle;
    }
    if (!options?.create) {
      throw new DOMException('Not found', 'NotFoundError');
    }
    const directory = new MemoryDirectoryHandle();
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) {
      return existing as unknown as FileSystemFileHandle;
    }
    if (!options?.create) {
      throw new DOMException('Not found', 'NotFoundError');
    }
    const file = new MemoryFileHandle(name);
    this.files.set(name, file);
    return file as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    if (this.files.delete(name)) {
      return;
    }
    if (this.directories.has(name)) {
      this.directories.delete(name);
      return;
    }
    if (!options?.recursive) {
      throw new DOMException('Not found', 'NotFoundError');
    }
  }
}

class MemoryStorage {
  readonly root = new MemoryDirectoryHandle();
  persistent = false;

  async getDirectory(): Promise<FileSystemDirectoryHandle> {
    return this.root as unknown as FileSystemDirectoryHandle;
  }

  async persist(): Promise<boolean> {
    this.persistent = true;
    return true;
  }

  async persisted(): Promise<boolean> {
    return this.persistent;
  }
}

const TEST_MODEL: StemModelCatalogEntry = {
  id: 'test-stem-model',
  label: 'Test Stem Model',
  modelVersion: 'test-v1',
  description: 'Tiny model fixture',
  stems: ['drums', 'bass', 'other', 'vocals'],
  inputSampleRate: 44_100,
  outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
  files: [{
    name: 'test.onnx',
    url: 'https://example.invalid/test.onnx',
    sizeBytes: 5,
  }],
  supportedBackends: ['webgpu', 'wasm'],
  testedBrowserRuntime: true,
  productionDropdown: true,
};

function responseFor(bytes: Uint8Array): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  });
}

describe('stem model catalog', () => {
  it('exposes only validated production models in the production list', () => {
    const productionModels = getProductionStemModels();
    expect(productionModels.map((model) => model.id)).toEqual([DEFAULT_STEM_MODEL_ID]);
    expect(getStemModelById(DEFAULT_STEM_MODEL_ID)).toMatchObject({
      label: 'Demucs HTDemucs Web',
      inputSampleRate: 44_100,
      outputStemOrder: ['drums', 'bass', 'other', 'vocals'],
      files: [{ name: 'htdemucs_embedded.onnx', sizeBytes: 180_534_758 }],
    });
    expect(getStemModelById('scnet-xl-ihf-onnx-experimental')?.productionDropdown).toBe(false);
  });
});

describe('StemModelManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads model files into OPFS, writes version metadata, and reloads buffers', async () => {
    const storage = new MemoryStorage();
    const fetchImpl = vi.fn(async () => responseFor(new Uint8Array([1, 2, 3, 4, 5])));
    const manager = new StemModelManager({
      catalog: [TEST_MODEL],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
      now: () => '2026-05-28T12:00:00.000Z',
    });
    const progress: number[] = [];

    expect(await manager.isModelCached(TEST_MODEL.id)).toBe(false);
    const status = await manager.ensureModelCached(TEST_MODEL.id, {
      onProgress: (event) => progress.push(event.progress),
    });

    expect(fetchImpl).toHaveBeenCalledWith(TEST_MODEL.files[0].url, {
      signal: undefined,
      cache: 'no-store',
    });
    expect(status).toMatchObject({
      cached: true,
      persistent: true,
      expectedBytes: 5,
      actualBytes: 5,
      files: [{ name: 'test.onnx', valid: true }],
    });
    expect(progress.at(-1)).toBe(1);
    expect(await manager.isModelCached(TEST_MODEL.id)).toBe(true);

    const buffers = await manager.loadModelBuffers(TEST_MODEL.id);
    expect(buffers).toHaveLength(1);
    expect([...new Uint8Array(buffers[0].buffer)]).toEqual([1, 2, 3, 4, 5]);
  });

  it('binds the default browser fetch implementation before downloading', async () => {
    const storage = new MemoryStorage();
    const fetchImpl = vi.fn(function boundFetchRequired(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(responseFor(new Uint8Array([1, 2, 3, 4, 5])));
    });
    vi.stubGlobal('fetch', fetchImpl);
    const manager = new StemModelManager({
      catalog: [TEST_MODEL],
      storage,
    });

    const status = await manager.ensureModelCached(TEST_MODEL.id);

    expect(fetchImpl).toHaveBeenCalledWith(TEST_MODEL.files[0].url, {
      signal: undefined,
      cache: 'no-store',
    });
    expect(status.cached).toBe(true);
  });

  it('treats files without matching metadata as invalid cache entries', async () => {
    const storage = new MemoryStorage();
    const root = await storage.getDirectory();
    const cacheRoot = await root.getDirectoryHandle('stem-separation-models', { create: true });
    const modelDir = await cacheRoot.getDirectoryHandle(TEST_MODEL.id, { create: true });
    const fileHandle = await modelDir.getFileHandle('test.onnx', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array([1, 2, 3, 4, 5]));
    await writable.close();

    const manager = new StemModelManager({
      catalog: [TEST_MODEL],
      fetchImpl: vi.fn() as unknown as typeof fetch,
      storage,
    });

    const status = await manager.getCacheStatus(TEST_MODEL.id);
    expect(status.cached).toBe(false);
    expect(status.files[0]).toMatchObject({
      cached: true,
      valid: false,
      reason: 'metadata-missing',
    });
  });

  it('cancels downloads through AbortSignal and removes partial files', async () => {
    const storage = new MemoryStorage();
    const abortController = new AbortController();
    const fetchImpl = vi.fn(async () => responseFor(new Uint8Array([1, 2, 3, 4, 5])));
    const manager = new StemModelManager({
      catalog: [TEST_MODEL],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage,
    });

    await expect(manager.ensureModelCached(TEST_MODEL.id, {
      signal: abortController.signal,
      onProgress: () => abortController.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });

    const status = await manager.getCacheStatus(TEST_MODEL.id);
    expect(status.cached).toBe(false);
    expect(status.files[0]).toMatchObject({
      cached: false,
      valid: false,
      reason: 'missing',
    });
  });
});
