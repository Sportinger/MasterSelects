import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectDB } from '../../src/services/projectDB';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { decodeProjectPackage } from '../../src/services/project/core/projectPackage';
import type { ProjectFile } from '../../src/services/project/types';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function writeChunkToBytes(chunk: FileSystemWriteChunkType): Promise<Uint8Array> {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer || Object.prototype.toString.call(chunk) === '[object ArrayBuffer]') {
    return new Uint8Array(chunk as ArrayBuffer);
  }
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof Blob) {
    if (typeof chunk.arrayBuffer === 'function') return new Uint8Array(await chunk.arrayBuffer());
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(chunk);
    });
  }
  throw new Error('Unsupported test write chunk');
}

class MemoryFileHandle {
  readonly kind = 'file' as const;
  private bytes = new Uint8Array();
  lastModified = Date.now();

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    const bytes = new Uint8Array(this.bytes);
    return {
      name: this.name,
      size: bytes.byteLength,
      lastModified: this.lastModified,
      type: '',
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => toArrayBuffer(bytes),
    } as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let position = 0;
    return {
      write: async (chunk: FileSystemWriteChunkType) => {
        const nextChunk = await writeChunkToBytes(chunk);
        const requiredLength = position + nextChunk.byteLength;
        if (requiredLength > this.bytes.byteLength) {
          const expanded = new Uint8Array(requiredLength);
          expanded.set(this.bytes);
          this.bytes = expanded;
        }
        this.bytes.set(nextChunk, position);
        position = requiredLength;
        this.lastModified = Date.now();
      },
      close: async () => undefined,
    } as FileSystemWritableFileStream;
  }

  async seed(content: string): Promise<void> {
    this.bytes = new TextEncoder().encode(content);
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly files = new Map<string, MemoryFileHandle>();
  readonly directories = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

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

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException('Entry not found', 'NotFoundError');
    }
  }

  async *values(): AsyncIterableIterator<MemoryFileHandle | MemoryDirectoryHandle> {
    yield* this.files.values();
    yield* this.directories.values();
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === this as unknown as FileSystemHandle;
  }
}

function createLegacyProject(): ProjectFile {
  return {
    version: 1,
    name: 'Legacy Cut',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [],
    compositions: [],
    folders: [],
    activeCompositionId: null,
    openCompositionIds: [],
    expandedFolderIds: [],
  };
}

describe('legacy project to .msproj migration', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['picker', 'existing-folder'])('creates a readable project despite unavailable handle cache (%s)', async (mode) => {
    const root = new MemoryDirectoryHandle('Projects');
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(root));
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.spyOn(projectDB, 'storeHandle').mockRejectedValue(new DOMException('Database connection is closing', 'InvalidStateError'));
    const core = new ProjectCoreService(fileStorageService);
    const result = mode === 'picker'
      ? await core.createProject('Offline Cache')
      : await core.createProjectInFolder(root as unknown as FileSystemDirectoryHandle, 'Offline Cache');
    expect(result).toBe(true);
    const file = root.directories.get('Offline Cache')?.files.get('Offline Cache.msproj');
    expect(file).toBeDefined();
    const archive = await decodeProjectPackage(await (await file!.getFile()).arrayBuffer());
    expect(archive.projectData.name).toBe('Offline Cache');
    expect(archive.projectData.compositions).toHaveLength(1);
  });

  it('creates a validated package while preserving the old project files and layout', async () => {
    const root = new MemoryDirectoryHandle('Legacy Cut');
    const legacyProject = createLegacyProject();
    await (await root.getFileHandle('project.json', { create: true }) as unknown as MemoryFileHandle)
      .seed(JSON.stringify(legacyProject));
    const analysis = await root.getDirectoryHandle('Analysis', { create: true }) as unknown as MemoryDirectoryHandle;
    await (await analysis.getFileHandle('media-1.json', { create: true }) as unknown as MemoryFileHandle)
      .seed('{"analyses":{}}');
    const raw = await root.getDirectoryHandle('Raw', { create: true }) as unknown as MemoryDirectoryHandle;
    await (await raw.getFileHandle('clip.mp4', { create: true }) as unknown as MemoryFileHandle).seed('raw-bytes');

    const core = new ProjectCoreService(fileStorageService);
    await expect(core.loadProject(root as unknown as FileSystemDirectoryHandle)).resolves.toBe(true);

    expect(root.files.has('project.json')).toBe(true);
    expect(root.directories.get('Raw')?.files.has('clip.mp4')).toBe(true);
    const packageFile = root.files.get('Legacy Cut.msproj');
    expect(packageFile).toBeDefined();
    const archive = await decodeProjectPackage(await (await packageFile!.getFile()).arrayBuffer());
    expect(archive.projectData.name).toBe('Legacy Cut');
    expect(new TextDecoder().decode(archive.entries.get('Analysis/media-1.json'))).toBe('{"analyses":{}}');
    expect(archive.manifest.mediaFolderName).toBe('Raw');
  });

  it('creates new projects with one package, one named media folder, and a hidden cache', async () => {
    const root = new MemoryDirectoryHandle('Fresh Cut');
    const core = new ProjectCoreService(fileStorageService) as ProjectCoreService & {
      initializeProject: (handle: FileSystemDirectoryHandle, name: string) => Promise<boolean>;
    };

    await expect(core.initializeProject(root as unknown as FileSystemDirectoryHandle, 'Fresh Cut'))
      .resolves.toBe(true);

    expect(root.files.has('Fresh Cut.msproj')).toBe(true);
    expect(root.files.has('project.json')).toBe(false);
    expect(root.directories.has('Fresh Cut Media')).toBe(true);
    expect(root.directories.has('.masterselects-cache')).toBe(false);
    expect(root.directories.has('Analysis')).toBe(false);
    expect(root.directories.has('Transcripts')).toBe(false);
    expect(root.directories.has('Proxy')).toBe(false);
    expect(root.directories.get('Fresh Cut Media')?.directories.has('Baked Audio')).toBe(true);
    expect(root.directories.get('Fresh Cut Media')?.directories.has('Downloads')).toBe(true);
    expect(root.directories.get('Fresh Cut Media')?.directories.has('Renders')).toBe(true);
    expect(root.directories.get('Fresh Cut Media')?.directories.has('.masterselects-cache')).toBe(true);
  });
});
