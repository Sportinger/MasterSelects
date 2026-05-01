import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const nativeCore = {
    createProjectAtPath: vi.fn(async () => true),
    loadProject: vi.fn(async () => true),
    restoreLastProject: vi.fn(async () => true),
    isSupported: vi.fn(() => true),
    getProjectPath: vi.fn(() => null),
    getProjectData: vi.fn(() => null),
    isProjectOpen: vi.fn(() => false),
    hasUnsavedChanges: vi.fn(() => false),
    markDirty: vi.fn(),
    needsPermission: vi.fn(() => false),
    getPendingProjectName: vi.fn(() => null),
    requestPendingPermission: vi.fn(async () => false),
    createProject: vi.fn(async () => true),
    saveProject: vi.fn(async () => true),
    closeProject: vi.fn(),
    createBackup: vi.fn(async () => true),
    renameProject: vi.fn(async () => true),
    saveKeysFile: vi.fn(async () => undefined),
    loadKeysFile: vi.fn(async () => false),
    updateProjectData: vi.fn(),
    updateMedia: vi.fn(),
    updateCompositions: vi.fn(),
    updateFolders: vi.fn(),
  };

  return {
    nativeCore,
    nativeClient: {
      isConnected: vi.fn(() => false),
      connect: vi.fn(async () => true),
      hasFsCommands: vi.fn(async () => true),
      getProjectRoot: vi.fn(async () => 'C:\\Users\\tester\\Documents\\MasterSelects'),
      grantPath: vi.fn(async () => true),
      pickFolderDetailed: vi.fn(async () => ({
        path: 'C:\\Projects',
        cancelled: false,
      })),
    },
    NativeProjectCoreService: vi.fn(function NativeProjectCoreService() {
      return nativeCore;
    }),
  };
});

vi.mock('../../src/services/nativeHelper/NativeHelperClient', () => ({
  NativeHelperClient: mocks.nativeClient,
}));

vi.mock('../../src/services/project/core/NativeProjectCoreService', () => ({
  NativeProjectCoreService: mocks.NativeProjectCoreService,
}));

async function importFreshProjectFileService() {
  vi.resetModules();
  const mod = await import('../../src/services/project/ProjectFileService');
  return mod.projectFileService;
}

function disableFileSystemAccessApi(): void {
  delete (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
  delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
}

describe('ProjectFileService native backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disableFileSystemAccessApi();
    mocks.nativeClient.isConnected.mockReturnValue(false);
    mocks.nativeClient.connect.mockResolvedValue(true);
    mocks.nativeClient.hasFsCommands.mockResolvedValue(true);
    mocks.nativeClient.getProjectRoot.mockResolvedValue('C:\\Users\\tester\\Documents\\MasterSelects');
    mocks.nativeClient.grantPath.mockResolvedValue(true);
    mocks.nativeClient.pickFolderDetailed.mockResolvedValue({
      path: 'C:\\Projects',
      cancelled: false,
    });
    mocks.nativeCore.createProjectAtPath.mockResolvedValue(true);
    mocks.nativeCore.loadProject.mockResolvedValue(true);
    mocks.nativeCore.restoreLastProject.mockResolvedValue(true);
  });

  it('creates projects through the native backend when FSA is unavailable', async () => {
    const projectFileService = await importFreshProjectFileService();

    const created = await projectFileService.createProject('Firefox Project');

    expect(created).toBe(true);
    expect(mocks.nativeClient.connect).toHaveBeenCalledTimes(1);
    expect(mocks.nativeClient.hasFsCommands).toHaveBeenCalledTimes(1);
    expect(mocks.nativeClient.pickFolderDetailed).toHaveBeenCalledWith(
      'Choose where to save your project',
      'C:/Users/tester/Documents/MasterSelects',
    );
    expect(mocks.nativeCore.createProjectAtPath).toHaveBeenCalledWith(
      'C:/Projects',
      'Firefox Project',
    );
    expect(mocks.nativeClient.grantPath).toHaveBeenCalledWith('C:/Projects');
    expect(projectFileService.activeBackend).toBe('native');
  });

  it('falls back to manual path entry when the native folder picker is unavailable', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('C:\\Manual\\Existing');
    mocks.nativeClient.pickFolderDetailed.mockResolvedValue({
      path: null,
      cancelled: false,
      error: 'Folder picker failed',
    });
    const projectFileService = await importFreshProjectFileService();

    const opened = await projectFileService.openProject();

    expect(opened).toBe(true);
    expect(promptSpy).toHaveBeenCalledWith(
      expect.stringContaining('Enter the folder path manually'),
      'C:/Users/tester/Documents/MasterSelects',
    );
    expect(mocks.nativeCore.loadProject).toHaveBeenCalledWith('C:/Manual/Existing');
    expect(mocks.nativeClient.grantPath).toHaveBeenCalledWith('C:/Manual/Existing');
  });

  it('restores the last project through the native backend on Firefox refresh', async () => {
    const projectFileService = await importFreshProjectFileService();

    const restored = await projectFileService.restoreLastProject();

    expect(restored).toBe(true);
    expect(mocks.nativeClient.connect).toHaveBeenCalledTimes(1);
    expect(mocks.nativeCore.restoreLastProject).toHaveBeenCalledTimes(1);
    expect(projectFileService.activeBackend).toBe('native');
  });
});
