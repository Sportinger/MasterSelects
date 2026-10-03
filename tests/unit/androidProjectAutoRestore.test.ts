import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAndroidProjectAutoRestoreHandle,
  isAndroidAutoRestoreProjectHandle,
  markAndroidProjectAutoRestoreReady,
  prepareAndroidProjectAutoRestore,
  restoreAndroidProjectAutomatically,
} from '../../src/services/project/androidProjectAutoRestore';

// The mirror is a confirmed repository archive in OPFS; the repository conversion itself is
// covered by the repository tests, so its boundary is replaced here.
const repository = vi.hoisted(() => {
  const sourceBackend = { locationId: 'fsa:source' };
  const owner = { writerEpoch: 'epoch', assertOwned: () => undefined, release: async () => undefined };
  const targetBackend = { locationId: 'opfs:mirror', acquireOwner: async () => owner };
  const descriptor = { repositoryId: 'source-repository' };
  const head = { revisionId: 'confirmed-head' };
  return { sourceBackend, targetBackend, owner, descriptor, head, opfsRoot: null as FileSystemDirectoryHandle | null };
});
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({
  prepareRepositoryOpen: vi.fn(async (location: unknown) => ({ options: { location, descriptor: repository.descriptor } })),
  backendForLocation: vi.fn(async (location: { kind: string }) => (
    location.kind === 'opfs' ? repository.targetBackend : repository.sourceBackend
  )),
  directoryForOpfs: vi.fn(async (path: string) => repository.opfsRoot!.getDirectoryHandle(path, { create: true })),
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryProjectOperations', () => ({
  createRepositoryAt: vi.fn(async () => undefined),
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: vi.fn(() => null),
  getActiveRepositoryDirectory: vi.fn(() => null),
  repositoryWorkspaceId: 'test-workspace',
}));
vi.mock('../../src/services/project/repository/persistence/recovery', () => ({
  recoverRepository: vi.fn(async () => ({ head: repository.head })),
}));
vi.mock('../../src/services/project/repository/archive/selectiveArchive', () => ({
  prepareArchive: vi.fn(async () => undefined),
}));

import { prepareRepositoryOpen } from '../../src/services/project/repository/lifecycle/repositoryLocations';
import { prepareArchive } from '../../src/services/project/repository/archive/selectiveArchive';

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

  async *entries(): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    for await (const handle of this.values()) yield [handle.name, handle];
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

  it('archives a picker-backed project into a separate OPFS repository and restores only after the mirror is marked ready', async () => {
    const opfsRoot = new MemoryDirectoryHandle('opfs');
    const source = new MemoryDirectoryHandle('Test');
    await source.addFile('project.json', '{"name":"Test"}');
    const raw = await source.getDirectoryHandle('Raw', { create: true }) as unknown as MemoryDirectoryHandle;
    await raw.addFile('clip.mp4', 'video-bytes');
    installAndroidStorage(opfsRoot);
    repository.opfsRoot = opfsRoot as unknown as FileSystemDirectoryHandle;
    const release = vi.spyOn(repository.owner, 'release');

    const copiedPaths: string[] = [];
    const mirror = await prepareAndroidProjectAutoRestore(
      source as unknown as FileSystemDirectoryHandle,
      (path) => copiedPaths.push(path),
    );

    // A fresh snapshot never overwrites the picked source or an earlier recovery copy.
    expect(mirror?.name).toMatch(/^Test \(Android .+\)$/);
    expect(opfsRoot.directories.get(mirror!.name)).toBe(mirror);
    expect(copiedPaths).toEqual(['Confirmed project repository']);
    expect(prepareRepositoryOpen).toHaveBeenCalledWith({ kind: 'fsa', handle: source }, 'test-workspace');
    expect(prepareArchive).toHaveBeenCalledWith(
      repository.sourceBackend,
      repository.descriptor,
      repository.head,
      repository.targetBackend,
      repository.owner,
      expect.objectContaining({ history: { kind: 'all' }, journals: 'all', media: 'linked' }),
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(await source.files.get('project.json')?.text()).toBe('{"name":"Test"}');
    expect(await source.directories.get('Raw')?.files.get('clip.mp4')?.text()).toBe('video-bytes');
    expect(isAndroidAutoRestoreProjectHandle(mirror)).toBe(true);
    expect(await getAndroidProjectAutoRestoreHandle()).toBeNull();

    // Preparing the mirror again reuses it instead of duplicating the snapshot.
    await expect(prepareAndroidProjectAutoRestore(mirror!)).resolves.toBe(mirror);
    expect(prepareArchive).toHaveBeenCalledTimes(1);

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
