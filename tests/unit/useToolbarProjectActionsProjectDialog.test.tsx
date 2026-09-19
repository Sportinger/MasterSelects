import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewProject: vi.fn(async () => true),
  projectFileService: {
    createProject: vi.fn(async () => true),
    getProjectData: vi.fn(() => null as { name: string } | null),
    getProjectHandle: vi.fn(() => null as FileSystemDirectoryHandle | null),
    getProjectPath: vi.fn(() => null as string | null),
    hasUnsavedChanges: vi.fn(() => true),
    isProjectOpen: vi.fn(() => false),
    renameProject: vi.fn(async () => true),
    saveProject: vi.fn(async () => true),
  },
  saveCurrentProject: vi.fn(async () => true),
  syncStoresToProject: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: mocks.projectFileService,
}));

vi.mock('../../src/services/projectSync', () => ({
  createNewProject: mocks.createNewProject,
  loadProjectToStores: vi.fn(),
  openExistingProject: vi.fn(),
  saveCurrentProject: mocks.saveCurrentProject,
  setProjectLoadProgress: vi.fn(),
  syncStoresToProject: mocks.syncStoresToProject,
}));

import { useToolbarProjectActions } from '../../src/components/common/toolbar/useToolbarProjectActions';
import { useTrackingStore } from '../../src/stores/trackingStore';
import type { TrackingAsset } from '../../src/types/trackingAsset';

function seedPreviousProjectTracking() {
  const assets = [{ id: 'previous-terrain', name: 'Previous terrain' }] as TrackingAsset[];
  useTrackingStore.setState({ assets, selectedAssetId: 'previous-terrain' });
  return assets;
}

function renderProjectActions() {
  const callbacks = {
    closeMenu: vi.fn(),
    openProjectNameDialog: vi.fn(),
    resetMediaProject: vi.fn(),
    setIsLoading: vi.fn(),
    setIsProjectOpen: vi.fn(),
    setNeedsPermission: vi.fn(),
    setPendingProjectName: vi.fn(),
    setProjectName: vi.fn(),
    setRecentProjects: vi.fn(),
    setShowSavedToast: vi.fn(),
  };

  const hook = renderHook(() => useToolbarProjectActions({
    ...callbacks,
    projectName: 'Current Project',
  }));

  return { ...hook, callbacks };
}

describe('toolbar project-name dialog routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTrackingStore.getState().reset();
    mocks.projectFileService.hasUnsavedChanges.mockReturnValue(true);
    mocks.projectFileService.createProject.mockResolvedValue(true);
    mocks.projectFileService.getProjectData.mockReturnValue(null);
    mocks.projectFileService.isProjectOpen.mockReturnValue(false);
    mocks.projectFileService.renameProject.mockResolvedValue(true);
    mocks.projectFileService.saveProject.mockResolvedValue(true);
    mocks.projectFileService.getProjectHandle.mockReturnValue(null);
    mocks.saveCurrentProject.mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not claim a failed save succeeded and explains recovery', async () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    mocks.saveCurrentProject.mockResolvedValue(false);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result, callbacks } = renderProjectActions();
    await act(async () => result.current.handleSave());
    expect(callbacks.setShowSavedToast).not.toHaveBeenCalledWith(true);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('Project not saved'));
  });

  it('renews folder access before saving without reloading the project', async () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    const requestPermission = vi.fn(async () => 'granted' as const);
    mocks.projectFileService.getProjectHandle.mockReturnValue({ requestPermission } as unknown as FileSystemDirectoryHandle);
    const { result, callbacks } = renderProjectActions();
    await act(async () => result.current.handleSave());
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(requestPermission.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.saveCurrentProject.mock.invocationCallOrder[0]);
    expect(callbacks.setShowSavedToast).toHaveBeenCalledWith(true);
  });

  it('keeps the editor unsaved when folder access is denied', async () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    mocks.projectFileService.getProjectHandle.mockReturnValue({
      requestPermission: vi.fn(async () => 'denied'),
    } as unknown as FileSystemDirectoryHandle);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result, callbacks } = renderProjectActions();
    await act(async () => result.current.handleSave());
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
    expect(callbacks.setShowSavedToast).not.toHaveBeenCalledWith(true);
  });

  it('requests permission from each retry gesture and saves only after a new grant', async () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    const requestPermission = vi.fn<() => Promise<PermissionState>>().mockResolvedValueOnce('denied');
    mocks.projectFileService.getProjectHandle.mockReturnValue({ requestPermission } as unknown as FileSystemDirectoryHandle);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result, callbacks } = renderProjectActions();
    await act(async () => result.current.handleSave());
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();

    let grant!: (value: PermissionState) => void;
    requestPermission.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const pending = result.current.handleSave();
    // No preceding asynchronous work may consume the Save gesture's activation.
    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(requestPermission).toHaveBeenLastCalledWith({ mode: 'readwrite' });
    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
    await act(async () => { grant('granted'); await pending; });
    expect(mocks.saveCurrentProject).toHaveBeenCalledOnce();
    expect(callbacks.setShowSavedToast).toHaveBeenCalledWith(true);
  });

  it('handles thrown save failures without a false success toast', async () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    mocks.saveCurrentProject.mockRejectedValue(new Error('storage unavailable'));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result, callbacks } = renderProjectActions();
    await act(async () => result.current.handleSave());
    expect(callbacks.setShowSavedToast).not.toHaveBeenCalledWith(true);
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('before closing'));
    expect(callbacks.closeMenu).toHaveBeenCalled();
  });

  it('opens the in-app New Project dialog with the unsaved warning state', () => {
    const { result, callbacks } = renderProjectActions();

    act(() => result.current.handleNew());

    expect(callbacks.closeMenu).toHaveBeenCalledTimes(1);
    expect(callbacks.openProjectNameDialog).toHaveBeenCalledWith({
      mode: 'new',
      initialName: 'New Project',
      hasUnsavedChanges: true,
    });
  });

  it('opens the in-app dialog for first Save and Save As', async () => {
    const { result, callbacks } = renderProjectActions();

    await act(async () => result.current.handleSave());
    act(() => result.current.handleSaveAs());

    expect(callbacks.openProjectNameDialog).toHaveBeenNthCalledWith(1, {
      mode: 'save',
      initialName: 'New Project',
    });
    expect(callbacks.openProjectNameDialog).toHaveBeenNthCalledWith(2, {
      mode: 'saveAs',
      initialName: 'Current Project',
    });
  });

  it('opens Rename Project with the current project name', () => {
    mocks.projectFileService.isProjectOpen.mockReturnValue(true);
    mocks.projectFileService.getProjectData.mockReturnValue({ name: 'Current Project' });
    const { result, callbacks } = renderProjectActions();

    act(() => result.current.handleRename());

    expect(callbacks.closeMenu).toHaveBeenCalledTimes(1);
    expect(callbacks.openProjectNameDialog).toHaveBeenCalledWith({
      mode: 'rename',
      initialName: 'Current Project',
    });
  });

  it('creates, resets, syncs, and saves a project whose name contains spaces', async () => {
    const { result, callbacks } = renderProjectActions();
    let submitError: string | null = 'not submitted';

    await act(async () => {
      submitError = await result.current.handleProjectNameSubmit('new', 'My New Project');
    });

    expect(submitError).toBeNull();
    expect(mocks.projectFileService.createProject).toHaveBeenCalledWith('My New Project');
    expect(callbacks.resetMediaProject).toHaveBeenCalledWith('My New Project');
    expect(mocks.syncStoresToProject).toHaveBeenCalledTimes(1);
    expect(mocks.projectFileService.saveProject).toHaveBeenCalledTimes(1);
    expect(callbacks.setProjectName).toHaveBeenCalledWith('My New Project');
    expect(callbacks.setIsProjectOpen).toHaveBeenCalledWith(true);
  });

  it('drops previous tracking and terrain before syncing the first blank-project save', async () => {
    seedPreviousProjectTracking();
    const { result, callbacks } = renderProjectActions();
    const trackingAtReset: unknown[] = [];
    const trackingAtSync: unknown[] = [];
    callbacks.resetMediaProject.mockImplementation(() => {
      trackingAtReset.push(useTrackingStore.getState().assets);
    });
    mocks.syncStoresToProject.mockImplementationOnce(async () => {
      trackingAtSync.push(useTrackingStore.getState().assets);
    });

    await act(async () => {
      expect(await result.current.handleProjectNameSubmit('new', 'Empty Project')).toBeNull();
    });

    expect(trackingAtReset).toEqual([[]]);
    expect(trackingAtSync).toEqual([[]]);
    expect(useTrackingStore.getState().selectedAssetId).toBeNull();
  });

  it('keeps the dialog retryable when the folder picker is cancelled or creation fails', async () => {
    const previousTracking = seedPreviousProjectTracking();
    mocks.projectFileService.createProject.mockResolvedValue(false);
    const { result, callbacks } = renderProjectActions();
    let submitError: string | null = null;

    await act(async () => {
      submitError = await result.current.handleProjectNameSubmit('new', 'My New Project');
    });

    expect(submitError).toContain('No project folder was selected');
    expect(callbacks.resetMediaProject).not.toHaveBeenCalled();
    expect(mocks.syncStoresToProject).not.toHaveBeenCalled();
    expect(useTrackingStore.getState().assets).toBe(previousTracking);
    expect(useTrackingStore.getState().selectedAssetId).toBe('previous-terrain');
  });

  it.each(['save', 'saveAs'] as const)(
    'copies the current stores without resetting them for %s',
    async (mode) => {
      const previousTracking = seedPreviousProjectTracking();
      const { result, callbacks } = renderProjectActions();
      let submitError: string | null = 'not submitted';

      await act(async () => {
        submitError = await result.current.handleProjectNameSubmit(mode, 'Project Copy');
      });

      expect(submitError).toBeNull();
      expect(mocks.createNewProject).toHaveBeenCalledWith('Project Copy');
      expect(useTrackingStore.getState().assets).toBe(previousTracking);
      expect(callbacks.resetMediaProject).not.toHaveBeenCalled();
      expect(callbacks.setProjectName).toHaveBeenCalledWith('Project Copy');
      expect(callbacks.setShowSavedToast).toHaveBeenCalledWith(true);
    },
  );

  it('renames the open project without creating a project copy', async () => {
    mocks.projectFileService.getProjectData.mockReturnValue({ name: 'Current Project' });
    const { result, callbacks } = renderProjectActions();
    let submitError: string | null = 'not submitted';

    await act(async () => {
      submitError = await result.current.handleProjectNameSubmit('rename', 'Renamed Project');
    });

    expect(submitError).toBeNull();
    expect(mocks.projectFileService.renameProject).toHaveBeenCalledWith('Renamed Project');
    expect(mocks.createNewProject).not.toHaveBeenCalled();
    expect(callbacks.setProjectName).toHaveBeenCalledWith('Renamed Project');
    expect(callbacks.setShowSavedToast).toHaveBeenCalledWith(true);
  });

  it('keeps first Save and Save As retryable when the final write fails', async () => {
    mocks.createNewProject.mockResolvedValue(false);
    const { result, callbacks } = renderProjectActions();

    let submitError: string | null = null;
    await act(async () => {
      submitError = await result.current.handleProjectNameSubmit('saveAs', 'Project Copy');
    });

    expect(submitError).toContain('could not be saved');
    expect(callbacks.setProjectName).not.toHaveBeenCalled();
    expect(callbacks.setShowSavedToast).not.toHaveBeenCalled();
  });
});
