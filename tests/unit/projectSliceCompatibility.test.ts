import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restoreLegacyStartupMediaState: vi.fn(async () => undefined),
  pickProxyFolder: vi.fn(async () => null),
  getProxyFolderName: vi.fn(() => null),
  showInExplorer: vi.fn(async () => ({ success: true, message: 'ok' })),
  clearTimeline: vi.fn(),
  loadState: vi.fn(),
  clearFrame: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore/legacyStartupRestore', () => ({
  restoreLegacyStartupMediaState: mocks.restoreLegacyStartupMediaState,
}));

vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: {
    pickProxyFolder: mocks.pickProxyFolder,
    getProxyFolderName: mocks.getProxyFolderName,
    showInExplorer: mocks.showInExplorer,
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      clearTimeline: mocks.clearTimeline,
      loadState: mocks.loadState,
    }),
  },
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    clearFrame: mocks.clearFrame,
  },
}));

const { createProjectSlice } = await import('../../src/stores/mediaStore/slices/projectSlice');
const {
  createPrimaryMediaObjectUrl,
  revokeAllMediaObjectUrls,
} = await import('../../src/services/project/mediaObjectUrlManager');

describe('media project slice compatibility', () => {
  afterEach(() => {
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
  });

  it('delegates legacy startup init to the explicit restore helper', async () => {
    const set = vi.fn();
    const get = vi.fn(() => ({}));
    const slice = createProjectSlice(set, get);

    await slice.initFromDB();

    expect(mocks.restoreLegacyStartupMediaState).toHaveBeenCalledWith(set, get);
  });

  it('does not expose retired IndexedDB project actions', () => {
    const slice = createProjectSlice(vi.fn(), vi.fn(() => ({})));

    expect('saveProject' in slice).toBe(false);
    expect('loadProject' in slice).toBe(false);
    expect('getProjectList' in slice).toBe(false);
    expect('deleteProject' in slice).toBe(false);
  });

  it('revokes media object urls when creating a new project', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:managed-primary');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const url = createPrimaryMediaObjectUrl('media-1', file);
    const set = vi.fn();
    const get = vi.fn(() => ({
      files: [{
        id: 'media-1',
        name: 'clip.mp4',
        type: 'video',
        parentId: null,
        createdAt: 1,
        file,
        url,
      }],
    }));
    const slice = createProjectSlice(set, get);

    slice.newProject();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:managed-primary');
    expect(mocks.clearTimeline).toHaveBeenCalled();
    expect(mocks.clearFrame).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      files: [],
      currentProjectName: 'Untitled Project',
    }));
  });
});
