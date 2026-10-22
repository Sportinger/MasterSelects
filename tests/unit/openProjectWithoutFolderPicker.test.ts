import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExpectedArchiveImportRejection, selectOpenProjectRoute } from '../../src/services/project/projectBackendAvailability';
import { listProjectFolderNames } from '../../src/services/project/core/projectRootAccess';
import {
  archiveProjectName,
  discardStoredProjectArchive,
  releaseRestoredProjectArchive,
  storeProjectArchiveInBrowser,
} from '../../src/services/project/browserProjectArchive';
import { writeZip } from '../../src/services/project/repository/archive/streamZip';

vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => null,
}));

// Production group: File > Open Project in Firefox/Safari without the Native
// Helper could only show guidance. It now opens browser-stored projects and
// imports .msproj archives into browser storage.

let truncateWrites = false;

class FakeFile {
  readonly kind = 'file' as const;
  data = new Blob([]);
  constructor(readonly name: string) {}
  async createWritable() {
    let pending = new Blob([]);
    return {
      write: async (blob: Blob) => { pending = blob; },
      close: async () => { this.data = truncateWrites ? pending.slice(1) : pending; },
      abort: async () => {},
    };
  }
  async getFile() { return new File([this.data], this.name); }
}

class FakeDirectory {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, FakeDirectory | FakeFile>();
  constructor(readonly name: string) {}
  private entry<T>(name: string, type: new (name: string) => T, create?: boolean): T {
    const existing = this.entries.get(name);
    if (existing instanceof type) return existing;
    if (existing) throw new DOMException('Wrong kind', 'TypeMismatchError');
    if (!create) throw new DOMException('Missing', 'NotFoundError');
    const created = new type(name);
    this.entries.set(name, created as FakeDirectory | FakeFile);
    return created;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) { return this.entry(name, FakeDirectory, options?.create); }
  async getFileHandle(name: string, options?: { create?: boolean }) { return this.entry(name, FakeFile, options?.create); }
  async removeEntry(name: string) { this.entries.delete(name); }
  async *values() { yield* this.entries.values(); }
}

let root: FakeDirectory;
const asHandle = (directory: FakeDirectory) => directory as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
  truncateWrites = false;
  root = new FakeDirectory('');
  vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => root) } });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Open Project backend selection', () => {
  it('uses a folder picker first, then the Native Helper, then browser storage', async () => {
    const helper = vi.fn().mockResolvedValue(true);
    await expect(selectOpenProjectRoute({ folderPicker: true, nativeHelper: helper, browserStorage: true })).resolves.toBe('folder-picker');
    expect(helper).not.toHaveBeenCalled();
    await expect(selectOpenProjectRoute({ folderPicker: false, nativeHelper: helper, browserStorage: true })).resolves.toBe('native-helper');
    helper.mockResolvedValue(false);
    await expect(selectOpenProjectRoute({ folderPicker: false, nativeHelper: helper, browserStorage: true })).resolves.toBe('browser-storage');
    await expect(selectOpenProjectRoute({ folderPicker: false, nativeHelper: helper, browserStorage: false })).resolves.toBe('unavailable');
  });
});

describe('.msproj archive import into browser storage', () => {
  it('copies the archive into a new project folder next to existing projects', async () => {
    const existing = await root.getDirectoryHandle('Cut', { create: true });
    await existing.getFileHandle('project.msrepo.json', { create: true });
    const cache = await root.getDirectoryHandle('archive-downloads', { create: true });
    await cache.getFileHandle('download.msproj', { create: true });
    await root.getDirectoryHandle('sam2-models', { create: true });

    const archive = new File(['archive-bytes'], 'Cut.msproj');
    const name = await storeProjectArchiveInBrowser(archive);

    expect(name).toBe('Cut (2)');
    const stored = (await root.getDirectoryHandle('Cut (2)')).entries.get('Cut (2).msproj') as FakeFile;
    expect(stored.data).toBe(archive);
    // The not yet opened archive is listed so a failed first open can be retried; caches are not projects.
    await expect(listProjectFolderNames(asHandle(root))).resolves.toEqual(['Cut', 'Cut (2)']);
  });

  it('rejects other files and removes an incomplete copy instead of keeping it', async () => {
    const wrongFile = await storeProjectArchiveInBrowser(new File(['x'], 'notes.zip')).catch((error: unknown) => error);
    expect(wrongFile).toMatchObject({ code: 'unsupported' });
    expect(isExpectedArchiveImportRejection(wrongFile)).toBe(true);
    truncateWrites = true;
    const shortCopy = await storeProjectArchiveInBrowser(new File(['archive-bytes'], 'Edit.msproj')).catch((error: unknown) => error);
    expect(shortCopy).toMatchObject({ code: 'io' });
    expect(isExpectedArchiveImportRejection(shortCopy)).toBe(false);
    expect([...root.entries.keys()]).toEqual([]);
  });

  it('cancels the copy through its signal and leaves no project folder behind', async () => {
    const before = new AbortController(); before.abort();
    await expect(storeProjectArchiveInBrowser(new File(['bytes'], 'Early.msproj'), before.signal)).rejects.toMatchObject({ code: 'cancelled' });
    const during = new AbortController();
    const write = FakeFile.prototype.createWritable;
    vi.spyOn(FakeFile.prototype, 'createWritable').mockImplementation(async function (this: FakeFile) {
      const writable = await write.call(this);
      return { ...writable, write: async (blob: Blob) => { await writable.write(blob); during.abort(); } };
    });
    await expect(storeProjectArchiveInBrowser(new File(['bytes'], 'Late.msproj'), during.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect([...root.entries.keys()]).toEqual([]);
    vi.restoreAllMocks();
  });

  it('derives a storage-safe folder name and discards an import that did not open', async () => {
    expect(archiveProjectName('Show: Act 1?.MSPROJ')).toBe('Show Act 1');
    expect(archiveProjectName('.msproj')).toBe('Imported Project');
    const name = await storeProjectArchiveInBrowser(new File(['bytes'], 'Show.msproj'));
    await discardStoredProjectArchive(name);
    expect(root.entries.has(name)).toBe(false);
  });
});

/** A repository archive reduced to its manifest; enough for naming the imported project. */
async function manifestArchive(fileName: string, manifest: Record<string, unknown>): Promise<File> {
  const parts: Uint8Array[] = [];
  async function* bytes(value: string) { yield new TextEncoder().encode(value); }
  async function* entries() { yield { path: 'archive-manifest.json', chunks: bytes(JSON.stringify(manifest)) }; }
  await writeZip(entries(), async chunk => { parts.push(chunk.slice()); });
  return new File(parts.map(part => part.slice().buffer as ArrayBuffer), fileName);
}
async function storedFile(folder: FakeDirectory, path: string[], content: string): Promise<void> {
  let directory = folder;
  for (const part of path.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
  (await directory.getFileHandle(path.at(-1)!, { create: true })).data = new Blob([content]);
}

describe('imported archive project naming and cleanup', () => {
  const format = 'masterselects-repository-archive';

  it('names the browser folder after the project recorded in the archive, with free-name suffixing', async () => {
    await expect(storeProjectArchiveInBrowser(await manifestArchive('export-final.msproj', { format, projectName: 'Opera: Night' }))).resolves.toBe('Opera Night');
    await expect(storeProjectArchiveInBrowser(await manifestArchive('other.msproj', { format, projectName: 'Opera: Night' }))).resolves.toBe('Opera Night (2)');
    expect(root.entries.has('Opera Night (2)')).toBe(true);
  });

  it('falls back to the file name for archives without a recorded project name', async () => {
    await expect(storeProjectArchiveInBrowser(await manifestArchive('export-Show.msproj', { format }))).resolves.toBe('export-Show');
    await expect(storeProjectArchiveInBrowser(new File(['not a zip'], 'Plain.msproj'))).resolves.toBe('Plain');
  });

  it('removes the archive copy only after its repository restore was recorded as complete', async () => {
    const restored = await root.getDirectoryHandle('Show', { create: true });
    await storedFile(restored, ['Show.msproj'], 'archive');
    await storedFile(restored, ['.masterselects', 'imports', 'a', 'complete.json'], JSON.stringify({ kind: 'repository-archive', package: 'Show.msproj', commit: { commitId: 'c' } }));
    await expect(releaseRestoredProjectArchive('Show')).resolves.toBe(true);
    expect(restored.entries.has('Show.msproj')).toBe(false);

    // An old-format package stays: its converted project still reads files from it.
    const legacy = await root.getDirectoryHandle('Old', { create: true });
    await storedFile(legacy, ['Old.msproj'], 'package');
    await storedFile(legacy, ['.masterselects', 'imports', 'b', 'complete.json'], JSON.stringify({ sourceId: 'x', commit: { commitId: 'c' } }));
    await expect(releaseRestoredProjectArchive('Old')).resolves.toBe(false);
    expect(legacy.entries.has('Old.msproj')).toBe(true);

    const unfinished = await root.getDirectoryHandle('Half', { create: true });
    await storedFile(unfinished, ['Half.msproj'], 'archive');
    await storedFile(unfinished, ['.masterselects', 'imports', 'c', 'target.json'], JSON.stringify({ kind: 'repository-archive', package: 'Half.msproj' }));
    await expect(releaseRestoredProjectArchive('Half')).resolves.toBe(false);
    expect(unfinished.entries.has('Half.msproj')).toBe(true);
  });
});
