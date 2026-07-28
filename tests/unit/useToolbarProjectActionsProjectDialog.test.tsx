import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewProject: vi.fn(async () => true),
  projectFileService: {
    createProject: vi.fn(async () => true),
    getProjectData: vi.fn(() => null),
    hasUnsavedChanges: vi.fn(() => true),
    isProjectOpen: vi.fn(() => false),
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

function renderProjectActions() {
  const callbacks = {
    closeMenu: vi.fn(),
    openProjectNameDialog: vi.fn(),
    resetMediaProject: vi.fn(),
    setEditName: vi.fn(),
    setIsEditingName: vi.fn(),
    setIsLoading: vi.fn(),
    setIsProjectOpen: vi.fn(),
    setNeedsPermission: vi.fn(),
    setPendingProjectName: vi.fn(),
    setProjectName: vi.fn(),
    setRecentProjects: vi.fn(),
    setRenameError: vi.fn(),
    setShowSavedToast: vi.fn(),
  };

  const hook = renderHook(() => useToolbarProjectActions({
    ...callbacks,
    editName: 'Current Project',
    isRenamingRef: { current: false },
    projectName: 'Current Project',
  }));

  return { ...hook, callbacks };
}

describe('toolbar project-name dialog routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFileService.hasUnsavedChanges.mockReturnValue(true);
    mocks.projectFileService.createProject.mockResolvedValue(true);
    mocks.projectFileService.saveProject.mockResolvedValue(true);
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

  it('keeps the dialog retryable when the folder picker is cancelled or creation fails', async () => {
    mocks.projectFileService.createProject.mockResolvedValue(false);
    const { result, callbacks } = renderProjectActions();
    let submitError: string | null = null;

    await act(async () => {
      submitError = await result.current.handleProjectNameSubmit('new', 'My New Project');
    });

    expect(submitError).toContain('No project folder was selected');
    expect(callbacks.resetMediaProject).not.toHaveBeenCalled();
    expect(mocks.syncStoresToProject).not.toHaveBeenCalled();
  });

  it.each(['save', 'saveAs'] as const)(
    'copies the current stores without resetting them for %s',
    async (mode) => {
      const { result, callbacks } = renderProjectActions();
      let submitError: string | null = 'not submitted';

      await act(async () => {
        submitError = await result.current.handleProjectNameSubmit(mode, 'Project Copy');
      });

      expect(submitError).toBeNull();
      expect(mocks.createNewProject).toHaveBeenCalledWith('Project Copy');
      expect(callbacks.resetMediaProject).not.toHaveBeenCalled();
      expect(callbacks.setProjectName).toHaveBeenCalledWith('Project Copy');
      expect(callbacks.setShowSavedToast).toHaveBeenCalledWith(true);
    },
  );

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
