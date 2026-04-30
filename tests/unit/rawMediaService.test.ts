import { describe, expect, it, vi } from 'vitest';
import { RawMediaService } from '../../src/services/project/domains/RawMediaService';
import type { FileStorageService } from '../../src/services/project/core/FileStorageService';

class FakeFileHandle {
  readonly kind = 'file' as const;
  writes = 0;

  constructor(
    readonly name: string,
    private file: File = new File([], name),
  ) {}

  async getFile(): Promise<File> {
    return this.file;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return {
      write: vi.fn(async (data: Blob | string) => {
        this.file = data instanceof File
          ? data
          : new File([data], this.name);
        this.writes += 1;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as FileSystemWritableFileStream;
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly directories = new Map<string, FakeDirectoryHandle>();
  private readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FakeDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }

    if (!options.create) {
      throw new DOMException('Not found', 'NotFoundError');
    }

    const created = new FakeDirectoryHandle(name);
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }

    if (!options.create) {
      throw new DOMException('Not found', 'NotFoundError');
    }

    const created = new FakeFileHandle(name);
    this.files.set(name, created);
    return created;
  }

  async *values(): AsyncIterableIterator<FakeDirectoryHandle | FakeFileHandle> {
    for (const directory of this.directories.values()) {
      yield directory;
    }
    for (const file of this.files.values()) {
      yield file;
    }
  }
}

function createService(): RawMediaService {
  const fileStorage = {
    navigateToFolder: async (
      baseHandle: FakeDirectoryHandle,
      folderPath: string,
      create = false,
    ): Promise<FakeDirectoryHandle | null> => {
      let folder = baseHandle;
      for (const part of folderPath.split('/').filter(Boolean)) {
        folder = await folder.getDirectoryHandle(part, { create });
      }
      return folder;
    },
  } as unknown as FileStorageService;

  return new RawMediaService(fileStorage);
}

describe('RawMediaService', () => {
  it('reuses existing same-size files inside Raw subfolders', async () => {
    const service = createService();
    const project = new FakeDirectoryHandle('Project');
    const raw = await project.getDirectoryHandle('Raw', { create: true });
    const sequenceFolder = await raw.getDirectoryHandle('scan', { create: true });
    const frame = new File(['frame-a'], 'scan000000.ply');
    const existingHandle = await sequenceFolder.getFileHandle('scan000000.ply', { create: true });
    const writable = await existingHandle.createWritable();
    await writable.write(frame);
    await writable.close();
    existingHandle.writes = 0;

    const result = await service.copyToRawFolder(
      project as unknown as FileSystemDirectoryHandle,
      frame,
      'scan/scan000000.ply',
    );

    expect(result).toEqual({
      handle: existingHandle,
      relativePath: 'Raw/scan/scan000000.ply',
      alreadyExisted: true,
    });
    expect(existingHandle.writes).toBe(0);
  });

  it('reads files back from nested Raw paths', async () => {
    const service = createService();
    const project = new FakeDirectoryHandle('Project');
    const raw = await project.getDirectoryHandle('Raw', { create: true });
    const sequenceFolder = await raw.getDirectoryHandle('hero', { create: true });
    const frame = new File(['frame-a'], 'hero000000.glb');
    const handle = await sequenceFolder.getFileHandle('hero000000.glb', { create: true });
    const writable = await handle.createWritable();
    await writable.write(frame);
    await writable.close();

    const result = await service.getFileFromRaw(
      project as unknown as FileSystemDirectoryHandle,
      'Raw/hero/hero000000.glb',
    );

    expect(result?.file).toBe(frame);
    expect(result?.handle).toBe(handle);
  });
});
