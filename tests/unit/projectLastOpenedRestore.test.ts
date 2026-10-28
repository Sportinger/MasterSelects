import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';

// The project restored at the next start is the last one opened, whatever its backend. Android Chrome has a
// folder picker (root mode 'fsa'), yet the phone creates its projects in browser storage: a folder project or
// Android mirror opened earlier must not win over the browser project created since.
const repo = vi.hoisted(() => ({
  session: null as null | { location: RepositoryLocation },
  projectName: '',
  opfsRoot: null as null | FileSystemDirectoryHandle,
  openRepositoryProject: vi.fn(),
  createRepositoryAt: vi.fn(),
}));
/** editorRepositoryLifecycle's activate hook: this tab's live browser project. */
function activate(location: RepositoryLocation, name: string) {
  repo.session = { location }; repo.projectName = name;
  if (location.kind === 'opfs') sessionStorage.setItem('ms.repository.last-opfs-path', location.path);
  else sessionStorage.removeItem('ms.repository.last-opfs-path');
}
vi.mock('../../src/services/project/repository/lifecycle/repositoryProjectOperations', () => ({
  createRepositoryAt: repo.createRepositoryAt,
  openRepositoryProject: repo.openRepositoryProject,
  renameRepositoryProject: vi.fn(async () => true),
  createIndependentProjectBackup: vi.fn(async () => true),
  repositoryHasUnsavedChanges: vi.fn(() => false),
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  closeEditorRepository: vi.fn(async () => { repo.session = null; }),
  flushEditorRepository: vi.fn(async () => true),
  getActiveRepositorySession: () => repo.session,
  getActiveRepositoryDirectory: () => null,
  readEditorRepositoryProject: () => (repo.session ? { name: repo.projectName } : null),
  isScratchRepository: () => false,
  repositoryWorkspaceId: 'test-workspace',
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({
  directoryForOpfs: vi.fn(async (path: string) => repo.opfsRoot!.getDirectoryHandle(path, { create: true })),
  opfsLocationExists: vi.fn(async (path: string) => repo.opfsRoot!.getDirectoryHandle(path).then(() => true, () => false)),
  isLegacyProjectLocation: vi.fn(async () => false),
}));
vi.mock('../../src/services/project/repository/transaction/editorRepositorySession', () => ({
  updateEditorRepositoryProjectFields: vi.fn(),
}));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({
  requestMediaSourceRootAccess: vi.fn(async () => undefined),
  requestMediaFileAccess: vi.fn(async () => undefined),
}));

import { projectDB } from '../../src/services/projectDB';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { withBrowserStorageProjectRoot } from '../../src/services/project/core/projectRootAccess';
import { getTabLastProjectHandleKey, getTabOpfsLastProjectNameKey, LEGACY_LAST_PROJECT_HANDLE_KEY } from '../../src/services/project/tabProjectPersistence';
import { markAndroidProjectAutoRestoreReady, restoreAndroidProjectAutomatically } from '../../src/services/project/androidProjectAutoRestore';

class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly directories = new Map<string, MemoryDirectory>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<MemoryDirectory> {
    const existing = this.directories.get(name); if (existing) return existing;
    if (!options?.create) throw new DOMException('Directory not found', 'NotFoundError');
    const directory = new MemoryDirectory(name); this.directories.set(name, directory); return directory;
  }
  async getFileHandle(): Promise<never> { throw new DOMException('File not found', 'NotFoundError'); }
  async *keys(): AsyncIterableIterator<string> { yield* this.directories.keys(); }
  async *values(): AsyncIterableIterator<MemoryDirectory> { yield* this.directories.values(); }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
}
const dir = (handle: MemoryDirectory) => handle as unknown as FileSystemDirectoryHandle;

const handles = new Map<string, FileSystemHandle>();
let opfsRoot: MemoryDirectory;
let folder: MemoryDirectory;

/** A browser restart: session storage (and with it this tab's live project) is gone; optionally a new tab id. */
function restartBrowser({ newTab = false } = {}) {
  sessionStorage.clear();
  repo.session = null;
  if (newTab) { handles.delete(getTabLastProjectHandleKey()); localStorage.removeItem(getTabOpfsLastProjectNameKey()); }
}
const lastOpened = () => repo.openRepositoryProject.mock.lastCall?.[0] as RepositoryLocation | undefined;

describe('restoring the last opened project across backends', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); handles.clear();
    repo.session = null; repo.projectName = '';
    opfsRoot = new MemoryDirectory('Origin root'); repo.opfsRoot = dir(opfsRoot);
    folder = new MemoryDirectory('Folder Cut');
    // Android Chrome: folder picker and OPFS.
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130', storage: { getDirectory: vi.fn(async () => opfsRoot) } });
    vi.spyOn(projectDB, 'storeHandle').mockImplementation(async (key, handle) => { handles.set(key, handle); });
    vi.spyOn(projectDB, 'getStoredHandle').mockImplementation(async key => handles.get(key) ?? null);
    vi.spyOn(projectDB, 'deleteHandle').mockImplementation(async key => { handles.delete(key); });
    vi.spyOn(projectDB, 'getAllHandles').mockResolvedValue([]);
    repo.openRepositoryProject.mockReset().mockImplementation(async (location: RepositoryLocation) => {
      activate(location, location.kind === 'opfs' ? location.path : location.kind === 'fsa' ? location.handle.name : 'Native');
    });
    repo.createRepositoryAt.mockReset().mockImplementation(async (location: RepositoryLocation, name: string) => activate(location, name));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([false, true])('reopens the browser project created after a folder project (new tab: %s)', async (newTab) => {
    const core = new ProjectCoreService(fileStorageService);
    await core.loadProject(dir(folder));
    expect(handles.get(LEGACY_LAST_PROJECT_HANDLE_KEY)).toBe(folder);
    await withBrowserStorageProjectRoot(() => core.createProject('Phone Cut'));
    restartBrowser({ newTab });
    repo.openRepositoryProject.mockClear();
    const restarted = new ProjectCoreService(fileStorageService);
    await expect(restarted.restoreLastProject()).resolves.toBe(true);
    expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Phone Cut' });
    expect(restarted.needsPermission()).toBe(false);
  });

  it('reopens a folder project opened after a browser project', async () => {
    const core = new ProjectCoreService(fileStorageService);
    await withBrowserStorageProjectRoot(() => core.createProject('Phone Cut'));
    await core.loadProject(dir(folder));
    restartBrowser({ newTab: true });
    repo.openRepositoryProject.mockClear();
    await expect(new ProjectCoreService(fileStorageService).restoreLastProject()).resolves.toBe(true);
    expect(lastOpened()).toEqual({ kind: 'fsa', handle: folder });
  });

  it('does not reopen an earlier Android mirror instead of the browser project created since', async () => {
    const core = new ProjectCoreService(fileStorageService);
    const mirror = await opfsRoot.getDirectoryHandle('Folder Cut (Android 1)', { create: true });
    // As after pendingProjectResume: the mirror is a known mirror handle, opened as browser storage.
    markAndroidProjectAutoRestoreReady(dir(mirror));
    await core.loadProject(dir(mirror));
    expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Folder Cut (Android 1)' });
    await withBrowserStorageProjectRoot(() => core.createProject('Phone Cut'));
    for (const reload of ['plain reload', 'browser restart']) {
      if (reload === 'browser restart') restartBrowser({ newTab: true });
      repo.openRepositoryProject.mockClear();
      const boot = new ProjectCoreService(fileStorageService);
      const opened = await restoreAndroidProjectAutomatically(handle => boot.loadProject(handle)) || await boot.restoreLastProject();
      expect(opened).toBe(true);
      expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Phone Cut' });
    }
  });

  it('skips a stale Android mirror on a reload whose live project is another browser project', async () => {
    const mirror = await opfsRoot.getDirectoryHandle('Folder Cut (Android 1)', { create: true });
    await opfsRoot.getDirectoryHandle('Phone Cut', { create: true });
    // Records written before this fix: the mirror was never forgotten when the phone project was created.
    markAndroidProjectAutoRestoreReady(dir(mirror));
    sessionStorage.setItem('ms.repository.last-opfs-path', 'Phone Cut');
    const boot = new ProjectCoreService(fileStorageService);
    const opened = await restoreAndroidProjectAutomatically(handle => boot.loadProject(handle)) || await boot.restoreLastProject();
    expect(opened).toBe(true);
    expect(repo.openRepositoryProject).toHaveBeenCalledTimes(1);
    expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Phone Cut' });
  });

  it('keeps restoring the Android mirror while it is the last opened project', async () => {
    const core = new ProjectCoreService(fileStorageService);
    const mirror = await opfsRoot.getDirectoryHandle('Folder Cut (Android 1)', { create: true });
    // As after pendingProjectResume: the mirror is a known mirror handle, opened as browser storage.
    markAndroidProjectAutoRestoreReady(dir(mirror));
    await core.loadProject(dir(mirror));
    expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Folder Cut (Android 1)' });
    restartBrowser({ newTab: true });
    repo.openRepositoryProject.mockClear();
    const boot = new ProjectCoreService(fileStorageService);
    await expect(restoreAndroidProjectAutomatically(handle => boot.loadProject(handle))).resolves.toBe(true);
    expect(lastOpened()).toEqual({ kind: 'opfs', path: 'Folder Cut (Android 1)' });
  });
});
