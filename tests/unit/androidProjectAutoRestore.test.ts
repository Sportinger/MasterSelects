import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAndroidProjectAutoRestoreHandle,
  markAndroidProjectAutoRestoreReady,
  prepareAndroidProjectAutoRestore,
  restoreAndroidProjectAutomatically,
} from '../../src/services/project/androidProjectAutoRestore';

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

class MemoryFileHandle {
  readonly kind = 'file' as const;
  private bytes = new Uint8Array();

  constructor(readonly name: string) {}

  async seed(value: string): Promise<void> {
    this.bytes = new TextEncoder().encode(value);
  }

  async getFile(): Promise<File> {
    const blob = new Blob([this.bytes]);
    Object.defineProperty(blob, 'name', { value: this.name });
    return blob as File;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return {
      write: async (chunk: FileSystemWriteChunkType) => {
        if (typeof chunk === 'string') {
          this.bytes = new TextEncoder().encode(chunk);
        } else if (chunk instanceof Blob) {
          this.bytes = await blobBytes(chunk);
        } else if (chunk instanceof ArrayBuffer) {
          this.bytes = new Uint8Array(chunk);
        } else if (ArrayBuffer.isView(chunk)) {
          this.bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        }
      },
      close: async () => undefined,
      abort: async () => undefined,
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly files = new Map<string, MemoryFileHandle>();
  readonly directories = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  async addFile(name: string, value: string): Promise<void> {
    const file = new MemoryFileHandle(name);
    await file.seed(value);
    this.files.set(name, file);
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing as unknown as FileSystemFileHandle;
    if (!options?.create) throw new DOMException('File not found', 'NotFoundError');
    const file = new MemoryFileHandle(name);
    this.files.set(name, file);
    return file as unknown as FileSystemFileHandle;
  }

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing as unknown as FileSystemDirectoryHandle;
    if (!options?.create) throw new DOMException('Directory not found', 'NotFoundError');
    const directory = new MemoryDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectoryHandle> {
    yield* this.files.values();
    yield* this.directories.values();
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === this as unknown as FileSystemHandle;
  }
}

function installAndroidStorage(root: MemoryDirectoryHandle): void {
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (Linux; Android 16)',
    storage: {
      getDirectory: vi.fn(async () => root as unknown as FileSystemDirectoryHandle),
    },
  });
}

describe('Android project auto-restore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('copies a picker-backed project recursively and restores only after the mirror is marked ready', async () => {
    const opfsRoot = new MemoryDirectoryHandle('opfs');
    const source = new MemoryDirectoryHandle('Test');
    await source.addFile('project.json', '{"name":"Test"}');
    const raw = await source.getDirectoryHandle('Raw', { create: true }) as unknown as MemoryDirectoryHandle;
    await raw.addFile('clip.mp4', 'video-bytes');
    installAndroidStorage(opfsRoot);

    const copiedPaths: string[] = [];
    const mirror = await prepareAndroidProjectAutoRestore(
      source as unknown as FileSystemDirectoryHandle,
      (path) => copiedPaths.push(path),
    );

    expect(mirror?.name).toBe('Test');
    expect(copiedPaths).toEqual(['project.json', 'Raw/clip.mp4']);
    expect(await getAndroidProjectAutoRestoreHandle()).toBeNull();

    const copied = mirror as unknown as MemoryDirectoryHandle;
    expect(await copied.files.get('project.json')?.text()).toBe('{"name":"Test"}');
    expect(await copied.directories.get('Raw')?.files.get('clip.mp4')?.text()).toBe('video-bytes');

    markAndroidProjectAutoRestoreReady(mirror!);
    const loadProject = vi.fn(async () => true);
    await expect(restoreAndroidProjectAutomatically(loadProject)).resolves.toBe(true);
    expect(loadProject).toHaveBeenCalledWith(mirror);
  });

  it('does nothing outside Android', async () => {
    const opfsRoot = new MemoryDirectoryHandle('opfs');
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      storage: { getDirectory: vi.fn(async () => opfsRoot) },
    });

    await expect(prepareAndroidProjectAutoRestore(
      new MemoryDirectoryHandle('Desktop') as unknown as FileSystemDirectoryHandle,
    )).resolves.toBeNull();
  });
});
