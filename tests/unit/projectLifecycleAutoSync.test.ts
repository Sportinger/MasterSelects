import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isProjectOpen: vi.fn(() => true),
  markDirty: vi.fn(),
  createProject: vi.fn(async () => true),
  saveProject: vi.fn(async () => true),
  isProjectStoreSyncInProgress: vi.fn(() => false),
  syncStoresToProject: vi.fn(async () => undefined),
  saveCurrentProject: vi.fn(async () => true),
  loadProjectToStores: vi.fn(async () => undefined),
  mediaSubscribe: vi.fn(),
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
    markDirty: mocks.markDirty,
    saveProject: mocks.saveProject,
    closeProject: vi.fn(),
    createProject: mocks.createProject,
    openProject: vi.fn(async () => true),
  },
}));

vi.mock('../../src/services/project/projectSave', () => ({
  isProjectStoreSyncInProgress: mocks.isProjectStoreSyncInProgress,
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
      newProject: vi.fn(),
    }),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    subscribe: mocks.timelineSubscribe,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsState.saveMode = 'manual';
    mocks.isProjectOpen.mockReturnValue(true);
    mocks.isProjectStoreSyncInProgress.mockReturnValue(false);
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
});
