import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isProjectOpen: vi.fn(() => true),
  hasUnsavedChanges: vi.fn(() => true),
  workspaceFiles: [] as Array<{ id: string }>,
  markDirty: vi.fn(),
  createProject: vi.fn(async () => true),
  saveProject: vi.fn(async () => true),
  isProjectStoreSyncInProgress: vi.fn(() => false),
  isProjectStoreDirtyMarkSuppressed: vi.fn(() => false),
  syncStoresToProject: vi.fn(async () => undefined),
  saveCurrentProject: vi.fn(async () => true),
  loadProjectToStores: vi.fn(async () => undefined),
  mediaSubscribe: vi.fn(),
  mediaNewProject: vi.fn(),
  mediaSetProjectName: vi.fn(),
  timelineSubscribe: vi.fn(),
  youtubeSubscribe: vi.fn(),
  dockSubscribe: vi.fn(),
  flashBoardSubscribe: vi.fn(),
  exportSubscribe: vi.fn(),
  midiSubscribe: vi.fn(),
  settingsState: {
    saveMode: 'manual',
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: mocks.isProjectOpen,
    hasUnsavedChanges: mocks.hasUnsavedChanges,
    markDirty: mocks.markDirty,
    saveProject: mocks.saveProject,
    closeProject: vi.fn(),
    createProject: mocks.createProject,
    openProject: vi.fn(async () => true),
  },
}));

vi.mock('../../src/services/project/projectSave', () => ({
  isProjectStoreSyncInProgress: mocks.isProjectStoreSyncInProgress,
  isProjectStoreDirtyMarkSuppressed: mocks.isProjectStoreDirtyMarkSuppressed,
  syncStoresToProject: mocks.syncStoresToProject,
  saveCurrentProject: mocks.saveCurrentProject,
}));

vi.mock('../../src/services/project/projectLoad', () => ({
  loadProjectToStores: mocks.loadProjectToStores,
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    subscribe: mocks.mediaSubscribe,
    getState: () => ({
      files: mocks.workspaceFiles,
      newProject: mocks.mediaNewProject,
      setProjectName: mocks.mediaSetProjectName,
    }),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    subscribe: mocks.timelineSubscribe,
    getState: () => ({ clips: [] }),
  },
}));

vi.mock('../../src/stores/youtubeStore', () => ({
  useYouTubeStore: {
    subscribe: mocks.youtubeSubscribe,
    getState: () => ({
      videos: [],
    }),
  },
}));

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: {
    subscribe: mocks.dockSubscribe,
    getState: () => ({
      layout: { panes: [] },
    }),
  },
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
  },
}));

vi.mock('../../src/stores/flashboardStore', () => ({
  useFlashBoardStore: {
    subscribe: mocks.flashBoardSubscribe,
    setState: vi.fn(),
    getState: () => ({ chatMessages: [] }),
  },
}));

vi.mock('../../src/stores/exportStore', () => ({
  useExportStore: {
    subscribe: mocks.exportSubscribe,
    getState: () => ({
      reset: vi.fn(),
    }),
  },
}));

vi.mock('../../src/stores/midiStore', () => ({
  useMIDIStore: {
    subscribe: mocks.midiSubscribe,
  },
}));

describe('project lifecycle auto sync', () => {
  it('retains projectless edits across auto-sync setup and releases protection after saving a project', async () => {
    const { setupAutoSync, teardownAutoSync } = await import('../../src/services/project/projectLifecycle');
    const { canReloadAfterChunkFailure } = await import('../../src/runtime/chunkReloadGuard');
    mocks.isProjectOpen.mockReturnValue(false);
    mocks.hasUnsavedChanges.mockReturnValue(false);
    setupAutoSync();
    try {
      expect(canReloadAfterChunkFailure()).toBe(true);
      mocks.isProjectStoreDirtyMarkSuppressed.mockReturnValue(true);
      (mocks.mediaSubscribe.mock.calls.at(-1)![1] as () => void)();
      expect(canReloadAfterChunkFailure()).toBe(true);
      mocks.isProjectStoreDirtyMarkSuppressed.mockReturnValue(false);
      (mocks.mediaSubscribe.mock.calls.at(-1)![1] as () => void)();
      expect(canReloadAfterChunkFailure()).toBe(false);
      setupAutoSync();
      expect(canReloadAfterChunkFailure()).toBe(false);
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      expect(mocks.saveProject).not.toHaveBeenCalled();
      expect(mocks.markDirty).not.toHaveBeenCalled();
      mocks.isProjectOpen.mockReturnValue(true);
      expect(canReloadAfterChunkFailure()).toBe(true);
    } finally {
      mocks.isProjectOpen.mockReturnValue(true);
      canReloadAfterChunkFailure();
      teardownAutoSync();
    }
  });

  it('protects imported projectless media already present when auto-sync starts', async () => {
    const { setupAutoSync, teardownAutoSync } = await import('../../src/services/project/projectLifecycle');
    const { canReloadAfterChunkFailure } = await import('../../src/runtime/chunkReloadGuard');
    mocks.isProjectOpen.mockReturnValue(false);
    mocks.hasUnsavedChanges.mockReturnValue(false);
    mocks.workspaceFiles.push({ id: 'unsaved-import' });
    setupAutoSync();
    try { expect(canReloadAfterChunkFailure()).toBe(false); }
    finally { mocks.workspaceFiles.length = 0; teardownAutoSync(); }
  });

  it('guards automatic chunk reloads while a dirty project is open and removes the guard on teardown', async () => {
    const { setupAutoSync, teardownAutoSync } = await import('../../src/services/project/projectLifecycle');
    const { canReloadAfterChunkFailure } = await import('../../src/runtime/chunkReloadGuard');
    setupAutoSync();
    expect(canReloadAfterChunkFailure()).toBe(false);
    mocks.isProjectOpen.mockReturnValue(false);
    mocks.hasUnsavedChanges.mockReturnValue(false);
    expect(canReloadAfterChunkFailure()).toBe(true);
    mocks.isProjectOpen.mockReturnValue(true);
    mocks.hasUnsavedChanges.mockReturnValue(true);
    mocks.workspaceFiles.length = 0;
    teardownAutoSync();
    expect(canReloadAfterChunkFailure()).toBe(true);
  });

  it('never saves in response to edits, keyframes or pointer release, even with a legacy preference', async () => {
    vi.useFakeTimers();
    const { setupAutoSync, teardownAutoSync } = await import('../../src/services/project/projectLifecycle');
    try {
      mocks.settingsState.saveMode = 'continuous';
      setupAutoSync();
      window.dispatchEvent(new Event('pointerdown'));
      (mocks.timelineSubscribe.mock.calls[0][1] as () => void)();
      (mocks.timelineSubscribe.mock.calls[1][1] as () => void)();
      window.dispatchEvent(new Event('pointerup'));
      await vi.advanceTimersByTimeAsync(30000);
      expect(mocks.markDirty).toHaveBeenCalledTimes(2);
      expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
      expect(mocks.saveProject).not.toHaveBeenCalled();
    } finally { teardownAutoSync(); vi.useRealTimers(); }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsState.saveMode = 'manual';
    mocks.isProjectOpen.mockReturnValue(true);
    mocks.hasUnsavedChanges.mockReturnValue(true);
    mocks.workspaceFiles.length = 0;
    mocks.isProjectStoreSyncInProgress.mockReturnValue(false);
    mocks.isProjectStoreDirtyMarkSuppressed.mockReturnValue(false);
    mocks.createProject.mockResolvedValue(true);
    mocks.saveProject.mockResolvedValue(true);
  });

  it('marks the project dirty when persisted MIDI bindings change', async () => {
    const { setupAutoSync } = await import('../../src/services/project/projectLifecycle');

    setupAutoSync();

    expect(mocks.midiSubscribe).toHaveBeenCalledTimes(4);
    expect(mocks.youtubeSubscribe).not.toHaveBeenCalled();

    const transportBindingListener = mocks.midiSubscribe.mock.calls[1]?.[1] as () => void;
    transportBindingListener();

    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('does not lose a store mutation that arrives while a save sync is in progress', async () => {
    mocks.isProjectStoreSyncInProgress.mockReturnValue(true);
    const { setupAutoSync } = await import('../../src/services/project/projectLifecycle');

    setupAutoSync();

    const mediaListener = mocks.mediaSubscribe.mock.calls[0]?.[1] as () => void;
    mediaListener();

    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
  });

  it('marks a completed media import dirty without immediately saving', async () => {
    mocks.settingsState.saveMode = 'continuous';
    const { setupAutoSync } = await import('../../src/services/project/projectLifecycle');

    setupAutoSync();

    const mediaListener = mocks.mediaSubscribe.mock.calls[0]?.[1] as (
      nextState: { files: Array<{ id: string; isImporting?: boolean }> },
      previousState: { files: Array<{ id: string; isImporting?: boolean }> },
    ) => void;
    mediaListener(
      { files: [{ id: 'media-android', isImporting: false }] },
      { files: [{ id: 'media-android', isImporting: true }] },
    );

    expect(mocks.saveCurrentProject).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
  });

  it('ignores store mutations explicitly owned by project hydration or save mirroring', async () => {
    mocks.isProjectStoreSyncInProgress.mockReturnValue(true);
    mocks.isProjectStoreDirtyMarkSuppressed.mockReturnValue(true);
    const { setupAutoSync } = await import('../../src/services/project/projectLifecycle');

    setupAutoSync();

    const mediaListener = mocks.mediaSubscribe.mock.calls[0]?.[1] as () => void;
    mediaListener();

    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('tears down previous auto-sync subscriptions before setting up again', async () => {
    const disposers = Array.from({ length: 10 }, () => vi.fn());
    let disposerIndex = 0;
    const nextDisposer = () => disposers[disposerIndex++] ?? vi.fn();

    mocks.mediaSubscribe.mockImplementation(() => nextDisposer());
    mocks.timelineSubscribe.mockImplementation(() => nextDisposer());
    mocks.midiSubscribe.mockImplementation(() => nextDisposer());
    mocks.flashBoardSubscribe.mockImplementation(() => nextDisposer());
    mocks.exportSubscribe.mockImplementation(() => nextDisposer());
    mocks.dockSubscribe.mockImplementation(() => nextDisposer());

    const { setupAutoSync } = await import('../../src/services/project/projectLifecycle');

    setupAutoSync();
    setupAutoSync();

    expect(mocks.youtubeSubscribe).not.toHaveBeenCalled();

    for (const dispose of disposers.slice(0, 10)) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('reports a failed initial project write to the caller', async () => {
    mocks.saveProject.mockResolvedValue(false);
    const { createNewProject } = await import('../../src/services/project/projectLifecycle');

    await expect(createNewProject('Project With Spaces')).resolves.toBe(false);
    expect(mocks.createProject).toHaveBeenCalledWith('Project With Spaces');
    expect(mocks.syncStoresToProject).toHaveBeenCalledTimes(1);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
  });

  it('creates a named blank project only after its folder has been selected', async () => {
    const { createBlankProject } = await import('../../src/services/project/projectLifecycle');

    await expect(createBlankProject('Quiet Documentary')).resolves.toBe('created');

    expect(mocks.createProject).toHaveBeenCalledWith('Quiet Documentary');
    expect(mocks.mediaNewProject).toHaveBeenCalledTimes(1);
    expect(mocks.mediaSetProjectName).toHaveBeenCalledWith('Quiet Documentary');
    expect(mocks.syncStoresToProject).toHaveBeenCalledTimes(1);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
  });

  it('keeps the current editor state when the folder picker is cancelled', async () => {
    mocks.createProject.mockResolvedValue(false);
    const { createBlankProject } = await import('../../src/services/project/projectLifecycle');

    await expect(createBlankProject('Cancelled Project')).resolves.toBe('not-created');

    expect(mocks.mediaNewProject).not.toHaveBeenCalled();
    expect(mocks.mediaSetProjectName).not.toHaveBeenCalled();
    expect(mocks.syncStoresToProject).not.toHaveBeenCalled();
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });
});
