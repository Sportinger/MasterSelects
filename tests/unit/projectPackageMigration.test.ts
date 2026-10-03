import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';

// Projects are repositories now: ProjectCoreService only chooses the location and hands it
// to the repository lifecycle. The repository format, the in-place conversion of old
// .msproj/project.json folders and its source proofs are covered by the repository tests
// (repositoryLegacyPackageLayout, repositoryLifecycle); this file keeps the core's contract.
const repo = vi.hoisted(() => ({
  session: null as null | { location: RepositoryLocation },
  projectName: '',
  opfsRoot: null as null | FileSystemDirectoryHandle,
  createRepositoryAt: vi.fn(),
  openRepositoryProject: vi.fn(),
  isLegacyProjectLocation: vi.fn(),
  requestLegacyImportTarget: vi.fn(),
  closeEditorRepository: vi.fn(),
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryProjectOperations', () => ({
  createRepositoryAt: repo.createRepositoryAt,
  openRepositoryProject: repo.openRepositoryProject,
  renameRepositoryProject: vi.fn(async () => true),
  createIndependentProjectBackup: vi.fn(async () => true),
  repositoryHasUnsavedChanges: vi.fn(() => false),
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  closeEditorRepository: repo.closeEditorRepository,
  flushEditorRepository: vi.fn(async () => true),
  getActiveRepositorySession: () => repo.session,
  readEditorRepositoryProject: () => (repo.session ? { name: repo.projectName } : null),
  isScratchRepository: () => false,
}));
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({
  directoryForOpfs: vi.fn(async (path: string) => repo.opfsRoot!.getDirectoryHandle(path, { create: true })),
  isLegacyProjectLocation: repo.isLegacyProjectLocation,
}));
vi.mock('../../src/services/project/repository/transaction/editorRepositorySession', () => ({
  updateEditorRepositoryProjectFields: vi.fn(),
}));
vi.mock('../../src/services/project/legacyImportTarget', () => ({
  requestLegacyImportTarget: repo.requestLegacyImportTarget,
}));
vi.mock('../../src/services/project/androidProjectAutoRestore', () => ({
  isAndroidAutoRestoreProjectHandle: () => false,
}));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({
  requestMediaSourceRootAccess: vi.fn(async () => undefined),
}));

import { projectDB } from '../../src/services/projectDB';
import { ProjectCoreService } from '../../src/services/project/core/ProjectCoreService';
import { fileStorageService } from '../../src/services/project/core/FileStorageService';
import { readProjectParent } from '../../src/services/project/core/projectDirectoryPersistence';
import { getRecentProjects } from '../../src/services/project/recentProjects';

class MemoryFileHandle {
  readonly kind = 'file' as const;
  readonly writes: string[] = [];

  constructor(readonly name: string, private content = '') {}

  async getFile(): Promise<File> {
    return new File([this.content], this.name);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return {
      write: async (chunk: FileSystemWriteChunkType) => { this.writes.push(String(chunk)); },
      close: async () => undefined,
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly files = new Map<string, MemoryFileHandle>();
  readonly directories = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  seedFile(name: string, content: string): MemoryFileHandle {
    const file = new MemoryFileHandle(name, content);
    this.files.set(name, file);
    return file;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing as unknown as FileSystemFileHandle;
    if (!options?.create) throw new DOMException('File not found', 'NotFoundError');
    return this.seedFile(name, '') as unknown as FileSystemFileHandle;
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

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === this as unknown as FileSystemHandle;
  }
}

function asDirectory(handle: MemoryDirectoryHandle): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

describe('project repository creation and legacy conversion', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    repo.session = null;
    repo.projectName = '';
    repo.opfsRoot = null;
    repo.createRepositoryAt.mockReset().mockImplementation(async (location: RepositoryLocation, name: string) => {
      repo.session = { location };
      repo.projectName = name;
    });
    repo.openRepositoryProject.mockReset().mockImplementation(async (location: RepositoryLocation, options?: { legacyTarget?: RepositoryLocation }) => {
      repo.session = { location: options?.legacyTarget ?? location };
      repo.projectName = location.kind === 'opfs' ? location.path : location.kind === 'fsa' ? location.handle.name : 'Native';
    });
    repo.isLegacyProjectLocation.mockReset().mockResolvedValue(false);
    repo.requestLegacyImportTarget.mockReset();
    repo.closeEditorRepository.mockReset().mockImplementation(async () => { repo.session = null; });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('creates and restores an OPFS repository by name without caching directory handles', async () => {
    const root = new MemoryDirectoryHandle('Origin root');
    repo.opfsRoot = asDirectory(root);
    vi.stubGlobal('showDirectoryPicker', undefined);
    vi.stubGlobal('showSaveFilePicker', undefined);
    vi.stubGlobal('FileSystemFileHandle', MemoryFileHandle);
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => root) } });
    const storeHandle = vi.spyOn(projectDB, 'storeHandle').mockRejectedValue(new Error('Unexpected handle cache write'));
    const getHandle = vi.spyOn(projectDB, 'getStoredHandle').mockRejectedValue(new Error('Unsafe legacy handle read'));

    const core = new ProjectCoreService(fileStorageService);
    expect(await core.createProject('Browser Cut')).toBe(true);
    expect(repo.createRepositoryAt).toHaveBeenCalledWith({ kind: 'opfs', path: 'Browser Cut' }, 'Browser Cut', false);
    expect(root.directories.has('Browser Cut')).toBe(true);
    expect(core.getProjectHandle()).toBe(root.directories.get('Browser Cut'));
    expect(getRecentProjects()).toMatchObject([{ backend: 'opfs', path: 'Browser Cut' }]);
    // Activating a browser-local repository records it for this tab (editor repository lifecycle).
    sessionStorage.setItem('ms.repository.last-opfs-path', 'Browser Cut');
    await core.closeProject();
    expect(core.getProjectHandle()).toBeNull();

    const reopened = new ProjectCoreService(fileStorageService);
    expect(await reopened.restoreLastProject()).toBe(true);
    expect(repo.openRepositoryProject).toHaveBeenLastCalledWith({ kind: 'opfs', path: 'Browser Cut' });
    expect(reopened.getProjectData()?.name).toBe('Browser Cut');
    // Rename also reacquires the origin root instead of reading projectsFolder.
    expect(await readProjectParent()).toBe(root);
    expect(storeHandle).not.toHaveBeenCalled();
    expect(getHandle).not.toHaveBeenCalled();
  });

  it.each(['picker', 'existing-folder'])('creates a project despite an unavailable handle cache (%s)', async (mode) => {
    const root = new MemoryDirectoryHandle('Projects');
    vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(root));
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.spyOn(projectDB, 'storeHandle').mockRejectedValue(new DOMException('Database connection is closing', 'InvalidStateError'));
    vi.spyOn(projectDB, 'getStoredHandle').mockResolvedValue(null);
    vi.spyOn(projectDB, 'getAllHandles').mockResolvedValue([]);

    const core = new ProjectCoreService(fileStorageService);
    const result = mode === 'picker'
      ? await core.createProject('Offline Cache')
      : await core.createProjectInFolder(asDirectory(root), 'Offline Cache');

    expect(result).toBe(true);
    const folder = root.directories.get('Offline Cache');
    expect(folder).toBeDefined();
    expect(repo.createRepositoryAt).toHaveBeenCalledWith({ kind: 'fsa', handle: folder }, 'Offline Cache', false);
    expect(core.getProjectHandle()).toBe(folder);
    expect(core.getProjectData()?.name).toBe('Offline Cache');
  });

  it('converts a legacy project in place while preserving the old project files and layout', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.spyOn(projectDB, 'storeHandle').mockResolvedValue(undefined);
    vi.spyOn(projectDB, 'getStoredHandle').mockResolvedValue(null);
    vi.spyOn(projectDB, 'getAllHandles').mockResolvedValue([]);
    const root = new MemoryDirectoryHandle('Legacy Cut');
    const projectJson = root.seedFile('project.json', JSON.stringify({ name: 'Legacy Cut' }));
    const raw = await root.getDirectoryHandle('Raw', { create: true }) as unknown as MemoryDirectoryHandle;
    const clip = raw.seedFile('clip.mp4', 'raw-bytes');
    repo.isLegacyProjectLocation.mockResolvedValue(true);
    repo.requestLegacyImportTarget.mockImplementation(async (handle: FileSystemDirectoryHandle) => handle);

    const core = new ProjectCoreService(fileStorageService);
    await expect(core.loadProject(asDirectory(root))).resolves.toBe(true);

    expect(repo.requestLegacyImportTarget).toHaveBeenCalledWith(root);
    expect(repo.openRepositoryProject).toHaveBeenCalledWith(
      { kind: 'fsa', handle: root },
      { legacyTarget: { kind: 'fsa', handle: root } },
    );
    expect(core.getProjectHandle()).toBe(root);
    expect(root.files.get('project.json')).toBe(projectJson);
    expect(projectJson.writes).toEqual([]);
    expect(root.directories.get('Raw')?.files.get('clip.mp4')).toBe(clip);
    expect(clip.writes).toEqual([]);
  });

  it('leaves a legacy project untouched when no conversion target is chosen', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    const root = new MemoryDirectoryHandle('Legacy Cut');
    repo.isLegacyProjectLocation.mockResolvedValue(true);
    repo.requestLegacyImportTarget.mockResolvedValue(null);

    const core = new ProjectCoreService(fileStorageService);
    await expect(core.loadProject(asDirectory(root))).resolves.toBe(false);
    expect(repo.openRepositoryProject).not.toHaveBeenCalled();
    expect(core.getProjectHandle()).toBeNull();
  });

  it('creates new projects as one named folder handed to a fresh repository', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn());
    vi.stubGlobal('showSaveFilePicker', vi.fn());
    vi.spyOn(projectDB, 'storeHandle').mockResolvedValue(undefined);
    vi.spyOn(projectDB, 'getStoredHandle').mockResolvedValue(null);
    vi.spyOn(projectDB, 'getAllHandles').mockResolvedValue([]);
    const parent = new MemoryDirectoryHandle('Projects');

    const core = new ProjectCoreService(fileStorageService);
    await expect(core.createProjectInFolder(asDirectory(parent), 'Fresh Cut', true)).resolves.toBe(true);

    expect([...parent.directories.keys()]).toEqual(['Fresh Cut']);
    expect(parent.files.size).toBe(0);
    const folder = parent.directories.get('Fresh Cut')!;
    // The repository writes its own layout; the core creates no legacy package or folders.
    expect(folder.files.size).toBe(0);
    expect(folder.directories.size).toBe(0);
    expect(repo.createRepositoryAt).toHaveBeenCalledWith({ kind: 'fsa', handle: folder }, 'Fresh Cut', true);
  });
});
