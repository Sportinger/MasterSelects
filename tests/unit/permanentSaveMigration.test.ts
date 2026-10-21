import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FallbackEntry, FallbackEntryStore } from '../../src/services/project/core/fallbackDirectoryHandle';

// Save permanently never removes a temporary (IndexedDB fallback) project before
// its persistent copy - in OPFS or a project folder - was verified.

function memoryStore(): FallbackEntryStore & { corrupt: boolean } {
  const entries = new Map<string, FallbackEntry>();
  const chunks = new Map<string, ArrayBuffer[]>();
  const missing = (path: string) => new DOMException(`${path} missing`, 'NotFoundError');
  return {
    corrupt: false,
    async get(path) { return entries.get(path); },
    async children(parent) { return [...entries.values()].filter(entry => entry.parent === parent); },
    async ensure(entry) {
      const existing = entries.get(entry.path); if (existing) return existing;
      if (entry.parent && !entries.has(entry.parent)) throw missing(entry.parent);
      entries.set(entry.path, entry); return entry;
    },
    async remove(path) {
      for (const key of [...entries.keys()]) if (key === path || key.startsWith(`${path}/`)) {
        const contentId = entries.get(key)!.contentId; if (contentId) chunks.delete(contentId); entries.delete(key);
      }
    },
    async putChunk(contentId, index, bytes) {
      const list = chunks.get(contentId) ?? [];
      list[index] = this.corrupt ? new Uint8Array(bytes.byteLength).fill(7).buffer : bytes; chunks.set(contentId, list);
    },
    async readChunks(contentId) { return chunks.get(contentId) ?? []; },
    async commit(path, contentId, size, lastModified) {
      const entry = entries.get(path); if (!entry || entry.kind !== 'file') throw missing(path);
      if (entry.contentId) chunks.delete(entry.contentId);
      entries.set(path, { ...entry, contentId, size, lastModified });
    },
    async discard(contentId) { chunks.delete(contentId); },
  };
}

const state = vi.hoisted(() => ({
  temporaryStore: null as unknown,
  session: null as null | Record<string, unknown>,
  scratch: false,
  lockedNames: new Set<string>(),
  createRepositoryAt: null as null | ((location: Record<string, unknown>) => Promise<void>),
  moveIdentity: vi.fn(async (..._args: string[]) => true),
  recents: [] as Array<Record<string, unknown>>,
  removeRecent: vi.fn(async (_id: string) => {}),
  flush: vi.fn(async () => true),
}));
vi.mock('../../src/services/project/repository/backends/repositoryLocationIdentity', () => ({
  moveRepositoryLocationIdentity: state.moveIdentity,
}));
vi.mock('../../src/services/project/core/indexedDbEntryStore', () => ({
  openIndexedDbEntryStore: async () => state.temporaryStore,
  fallbackStoreExists: async () => true,
}));
vi.mock('../../src/services/project/recentProjects', () => ({
  addRecentOpfsProject: vi.fn(async () => {}), getRecentProjects: () => state.recents, removeRecentProject: state.removeRecent,
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => state.session,
  flushEditorRepository: () => state.flush(),
  isScratchRepository: () => state.scratch,
  readEditorRepositoryProject: () => ({ name: 'My Project' }),
}));
vi.mock('../../src/services/project/repository/lifecycle/exportProjectArchive', () => ({
  exportCurrentProjectArchive: vi.fn(), pickArchiveOutput: vi.fn(),
}));
// The real project core is used; its unrelated collaborators stay out of the module graph.
vi.mock('../../src/services/projectDB', () => ({ projectDB: {} }));
vi.mock('../../src/services/project/androidProjectAutoRestore', () => ({ isAndroidAutoRestoreProjectHandle: () => false }));
vi.mock('../../src/services/project/legacyImportTarget', () => ({ requestLegacyImportTarget: vi.fn() }));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({ requestMediaSourceRootAccess: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/editorRepositorySession', () => ({ updateEditorRepositoryProjectFields: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({
  isLegacyProjectLocation: vi.fn(async () => false),
  // Same resolution as the real helper: the location's explicit store, else this tab's choice.
  directoryForOpfs: async (path: string, store?: 'opfs' | 'indexeddb') => {
    const roots = await import('../../src/services/project/core/browserStorageRoot');
    let folder = await (store ? roots.getBrowserStorageRootOf(store) : roots.getBrowserStorageRoot());
    for (const part of path.split('/')) folder = await folder.getDirectoryHandle(part, { create: true });
    return folder;
  },
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryProjectOperations', () => ({
  createRepositoryAt: (location: Record<string, unknown>) => state.createRepositoryAt!(location),
}));

const bytes = (text: string) => new TextEncoder().encode(text);
let temporary: ReturnType<typeof memoryStore>;
let persistent: ReturnType<typeof memoryStore>;
let persistentRoot: FileSystemDirectoryHandle;

async function writeFile(root: FileSystemDirectoryHandle, path: string, content: Uint8Array) {
  const parts = path.split('/'); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
  const writable = await (await folder.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
  await writable.write(content); await writable.close();
}
async function hasEntry(root: FileSystemDirectoryHandle, name: string) {
  try { await root.getDirectoryHandle(name); return true; } catch { return false; }
}

async function seedTemporaryProject(name = 'My Project') {
  const { createFallbackDirectoryRoot } = await import('../../src/services/project/core/fallbackDirectoryHandle');
  const root = createFallbackDirectoryRoot(temporary);
  await writeFile(root, `${name}/project.msrepo.json`, bytes(JSON.stringify({ format: 'masterselects-repository', formatVersion: 1, repositoryId: `repo-${name}`, lineageId: 'lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] })));
  await writeFile(root, `${name}/.masterselects/segments/s1.msseg`, new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251));
  return root;
}

function fakeSession(location: Record<string, unknown>, options: { writable?: boolean; revisions?: string[]; failedReads?: number; lineageId?: string } = {}) {
  const revisions = new Set(options.revisions ?? ['rev-1']);
  let failedReads = options.failedReads ?? 0;
  return { location, opening: { writable: options.writable ?? true }, coordinator: { getProjection: () => ({ revisionId: 'rev-1' }) },
    descriptor: { lineageId: options.lineageId ?? 'lineage' },
    storage: { async getRevision(id: string) {
      if (failedReads-- > 0) throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
      return revisions.has(id) ? { revisionId: id } : null;
    } } };
}

beforeEach(async () => {
  vi.resetModules();
  sessionStorage.clear();
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() { return null; } });
  temporary = memoryStore(); persistent = memoryStore();
  state.recents = []; state.removeRecent.mockClear(); state.flush.mockReset(); state.flush.mockResolvedValue(true);
  state.temporaryStore = temporary; state.session = null; state.scratch = false; state.lockedNames.clear(); state.createRepositoryAt = null;
  const { createFallbackDirectoryRoot } = await import('../../src/services/project/core/fallbackDirectoryHandle');
  persistentRoot = createFallbackDirectoryRoot(persistent);
  vi.stubGlobal('navigator', {
    storage: { getDirectory: async () => persistentRoot, persisted: async () => false, persist: async () => true },
    locks: { request: async (name: string, _options: unknown, callback: (lock: object | null) => unknown) => callback(state.lockedNames.has(name) ? null : {}) },
  });
  // This tab runs on the fallback, as after WebKit refused OPFS.
  sessionStorage.setItem('ms.browserStorage.kind', 'indexeddb');
});
afterEach(() => vi.unstubAllGlobals());

/** The editor's project core, as the toolbar hands it to the move (projectFileService.createProjectInBrowserStorage). */
async function projectCore() {
  const { ProjectCoreService } = await import('../../src/services/project/core/ProjectCoreService');
  const core = new ProjectCoreService({} as never);
  return { core, openCopy: (path: string, name: string) => core.createProjectInBrowserStorage(path, name) };
}

describe('moving projects that are not open', () => {
  it('copies and verifies every file before removing the temporary project', async () => {
    const temporaryRoot = await seedTemporaryProject();
    await writeFile(persistentRoot, 'My Project/keep.txt', bytes('existing'));
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    expect(await migration.listTemporaryProjects()).toEqual(['My Project']);
    expect(await migration.canUsePersistentBrowserStorage()).toBe(true);

    const moved = await migration.moveTemporaryProject('My Project');
    expect(moved).toEqual({ from: 'My Project', to: 'My Project (2)', removedTemporary: true });
    // The copy keeps its repository id, so it takes over the writer registration instead of opening read-only.
    expect(state.moveIdentity).toHaveBeenCalledWith('repo-My Project', `indexeddb:${location.origin}:My Project`, `opfs:${location.origin}:My Project (2)`);
    const copy = await persistentRoot.getDirectoryHandle('My Project (2)');
    const segment = await (await (await (await copy.getDirectoryHandle('.masterselects')).getDirectoryHandle('segments')).getFileHandle('s1.msseg')).getFile();
    expect(segment.size).toBe(3 * 1024 * 1024);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
  });

  it('keeps the temporary project when the copy does not verify', async () => {
    const temporaryRoot = await seedTemporaryProject();
    persistent.corrupt = true;
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    await expect(migration.moveTemporaryProject('My Project')).rejects.toThrow(/could not be verified/);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
    expect(await hasEntry(persistentRoot, 'My Project')).toBe(false);
  });

  it('refuses to move a project another tab holds open', async () => {
    const temporaryRoot = await seedTemporaryProject();
    state.lockedNames.add('ms.repository.writer:repo-My Project');
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    await expect(migration.moveTemporaryProject('My Project')).rejects.toMatchObject({ code: 'ownership' });
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
    expect(await hasEntry(persistentRoot, 'My Project')).toBe(false);
  });

  it('reports persistent storage as unavailable while the browser refuses OPFS', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => { throw new DOMException('refused', 'SecurityError'); } } });
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    expect(await migration.canUsePersistentBrowserStorage()).toBe(false);
  });
});

describe('moving the open temporary project', () => {
  it('switches to OPFS and removes the temporary copy only after verification', async () => {
    const temporaryRoot = await seedTemporaryProject();
    state.session = fakeSession({ kind: 'opfs', path: 'My Project' });
    state.createRepositoryAt = async location => { state.session = fakeSession(location); };
    const root = await import('../../src/services/project/core/browserStorageRoot');
    await root.getBrowserStorageRoot();
    expect(root.getBrowserStorageKind()).toBe('indexeddb');
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    const { openCopy } = await projectCore();
    const result = await migration.moveActiveProjectToPersistentBrowserStorage(openCopy);
    expect(result).toMatchObject({ from: 'My Project', to: 'My Project', removedTemporary: true, persisted: true });
    expect(state.session?.location).toEqual({ kind: 'opfs', path: 'My Project', store: 'opfs' });
    expect(root.getBrowserStorageKind()).toBe('opfs');
    expect(sessionStorage.getItem('ms.browserStorage.kind')).toBe('opfs');
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
  });

  it('re-adopts the copy in the project core so routed files land in OPFS, not in the removed temporary folder', async () => {
    const temporaryRoot = await seedTemporaryProject();
    state.session = fakeSession({ kind: 'opfs', path: 'My Project' });
    state.createRepositoryAt = async location => { state.session = fakeSession(location); };
    await (await import('../../src/services/project/core/browserStorageRoot')).getBrowserStorageRoot();
    const { core, openCopy } = await projectCore();
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    await migration.moveActiveProjectToPersistentBrowserStorage(openCopy);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
    // Thumbnails, waveforms and caches resolve their folder through getProjectHandle().
    await writeFile(core.getProjectHandle()!, 'Cache/thumbnails/t1.jpg', bytes('thumb'));
    const copy = await persistentRoot.getDirectoryHandle('My Project');
    const thumbnail = await (await (await (await copy.getDirectoryHandle('Cache')).getDirectoryHandle('thumbnails')).getFileHandle('t1.jpg')).getFile();
    expect(thumbnail.size).toBe(5);
  });

  it('keeps the temporary copy and the fallback when the copy lacks the saved revision', async () => {
    const temporaryRoot = await seedTemporaryProject();
    state.session = fakeSession({ kind: 'opfs', path: 'My Project' });
    state.createRepositoryAt = async location => { state.session = fakeSession(location, { revisions: [] }); };
    const root = await import('../../src/services/project/core/browserStorageRoot');
    await root.getBrowserStorageRoot();
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    await expect(migration.moveActiveProjectToPersistentBrowserStorage((await projectCore()).openCopy)).rejects.toThrow(/temporary project was kept/);
    expect(root.getBrowserStorageKind()).toBe('indexeddb');
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('never deletes the browser recovery area', async () => {
    const temporaryRoot = await seedTemporaryProject('repository-scratch');
    state.scratch = true;
    state.session = fakeSession({ kind: 'opfs', path: 'repository-scratch' });
    state.createRepositoryAt = async location => { state.session = fakeSession(location); };
    await (await import('../../src/services/project/core/browserStorageRoot')).getBrowserStorageRoot();
    const migration = await import('../../src/services/project/permanentSave/browserStorageMigration');
    expect(await migration.moveActiveProjectToPersistentBrowserStorage((await projectCore()).openCopy)).toMatchObject({ removedTemporary: false });
    expect(await hasEntry(temporaryRoot, 'repository-scratch')).toBe(true);
  });
});

describe('saving the open temporary project to a folder', () => {
  async function prepare() {
    const temporaryRoot = await seedTemporaryProject();
    state.session = fakeSession({ kind: 'opfs', path: 'My Project' });
    await (await import('../../src/services/project/core/browserStorageRoot')).getBrowserStorageRoot();
    return { temporaryRoot, actions: await import('../../src/services/project/permanentSave/permanentSaveActions') };
  }

  it('leaves everything in place when no folder is chosen', async () => {
    const { temporaryRoot, actions } = await prepare();
    expect(await actions.saveActiveProjectToFolder('My Project', async () => false)).toEqual({ status: 'cancelled' });
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('keeps the temporary copy when the folder copy opens read-only', async () => {
    const { temporaryRoot, actions } = await prepare();
    await expect(actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }, { writable: false }); return true;
    })).rejects.toThrow(/read-only/);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('removes the temporary copy once the folder project is open and verified', async () => {
    const { temporaryRoot, actions } = await prepare();
    expect(await actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }); return true;
    })).toEqual({ status: 'saved', removedTemporary: true });
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
  });

  it('forgets the removed temporary copy in the recent projects, never a permanent browser project', async () => {
    const { actions } = await prepare();
    state.recents = [{ id: 'permanent', backend: 'opfs', path: 'My Project', store: 'opfs' }, { id: 'temporary', backend: 'opfs', path: 'My Project', store: 'indexeddb' }];
    await actions.saveActiveProjectToFolder('My Project', async () => { state.session = fakeSession({ kind: 'fsa', handle: {} }); return true; });
    expect(state.removeRecent).toHaveBeenCalledExactlyOnceWith('temporary');
  });

  it('reads the new folder history once more when the first read fails', async () => {
    const { temporaryRoot, actions } = await prepare();
    expect(await actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }, { failedReads: 1 }); return true;
    })).toEqual({ status: 'saved', removedTemporary: true });
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
  });

  it('saves again and completes when saving the latest edits failed after the folder opened', async () => {
    const { temporaryRoot, actions } = await prepare();
    const lateFailure = new Error('A requested file or directory could not be found at the time an operation was processed.');
    expect(await actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }); throw lateFailure;
    })).toEqual({ status: 'saved', removedTemporary: true });
    expect(state.flush).toHaveBeenCalledOnce();
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(false);
  });

  it('reports edits that still wait for their save without keeping the verified temporary copy', async () => {
    const { actions } = await prepare();
    state.flush.mockRejectedValue(new Error('disk busy'));
    expect(await actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }); throw new Error('sync failed');
    })).toEqual({ status: 'saved', removedTemporary: true, unsavedChanges: 'disk busy' });
  });

  it('says the folder copy is open but unverified, and keeps the temporary copy', async () => {
    const { temporaryRoot, actions } = await prepare();
    const saving = actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }, { failedReads: 2 }); return true;
    });
    await expect(saving).rejects.toBeInstanceOf(actions.FolderCopyUnverifiedError);
    await expect(saving).rejects.toThrow(/opens from the chosen folder.*could not be confirmed.*temporary copy was kept/);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('rejects a folder that holds a different project', async () => {
    const { temporaryRoot, actions } = await prepare();
    await expect(actions.saveActiveProjectToFolder('My Project', async () => {
      state.session = fakeSession({ kind: 'fsa', handle: {} }, { lineageId: 'other' }); return true;
    })).rejects.toThrow(/different project/);
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('passes a failure on unchanged when the editor never switched to the folder', async () => {
    const { temporaryRoot, actions } = await prepare();
    const early = new Error('Folder could not be created');
    await expect(actions.saveActiveProjectToFolder('My Project', async () => { throw early; })).rejects.toBe(early);
    expect(state.flush).not.toHaveBeenCalled();
    expect(await hasEntry(temporaryRoot, 'My Project')).toBe(true);
  });

  it('names the archive after the project', async () => {
    const { actions } = await prepare();
    expect(actions.archiveFileName('Show: Act 1/2')).toBe('Show- Act 1-2');
    expect(actions.archiveFileName('  ')).toBe('Untitled Project');
  });
});
