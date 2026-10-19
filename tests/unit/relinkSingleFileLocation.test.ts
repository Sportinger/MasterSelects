import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let state = { files: [] as Array<Record<string, unknown>> };
  return {
    store: { getState: () => state, setState: (update: (current: typeof state) => typeof state) => { state = { ...state, ...update(state) }; } },
    resolveLocation: vi.fn(),
  };
});

vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: mocks.store }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: [] }) } }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ copyMediaToProject: false }) } }));
vi.mock('../../src/stores/mediaStore/slices/fileManageSlice', () => ({
  createMediaSourceReplacementPatch: async () => ({}),
  createMediaSourceReplacementResetPatch: () => ({}),
  updateTimelineClips: vi.fn(async () => {}),
}));
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: { activeBackend: 'fsa', requiresProjectLocalMediaCopies: () => false, isProjectOpen: () => false },
}));
vi.mock('../../src/services/timeline/timelineCacheInvalidation', () => ({
  collectTimelineAudioCacheRefsFromClips: () => [], invalidateTimelineMediaCaches: vi.fn(async () => {}),
}));
vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  collectMediaFileObjectUrls: () => [], createMediaObjectUrl: () => 'blob:x', createRenderablePrimaryMediaObjectUrl: async () => 'blob:media',
  getGaussianSplatSequenceFrameObjectUrlKey: () => '', getModelSequenceFrameObjectUrlKey: () => '', revokeMediaFileObjectUrls: () => {},
}));
vi.mock('../../src/services/project/mediaSourceValidation', () => ({
  getMediaSourceMismatch: async () => null, readMediaSourceFingerprint: async () => 'fingerprint',
}));
vi.mock('../../src/services/project/mediaSourceRoots', () => ({ resolveProjectMediaSourceLocation: mocks.resolveLocation }));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { storeHandle: vi.fn(async () => {}) } }));
vi.mock('../../src/services/fileSystemService', () => ({ fileSystemService: { storeFileHandle: vi.fn() } }));
vi.mock('../../src/services/project/linkedMediaDemand', () => ({ isLinkedMediaDeferred: () => false }));
vi.mock('../../src/services/project/linkedMediaSources', () => ({ attachLinkedMediaSourceFile: vi.fn() }));

import { applyRelinkMatch } from '../../src/services/project/relinkMedia';

describe('single-file relink location', () => {
  beforeEach(() => {
    mocks.store.setState(() => ({ files: [{ id: 'a001', name: 'A001.mp4', type: 'video', fileSize: 5, sourceRootId: 'root:old', sourceRelativePath: 'Old/A001.mp4' }] }));
    mocks.resolveLocation.mockReset();
  });

  it('records the known source folder that contains a file picked on its own', async () => {
    const file = new File(['bytes'], 'A001.mp4');
    const handle = { kind: 'file', name: 'A001.mp4', getFile: async () => file } as unknown as FileSystemFileHandle;
    mocks.resolveLocation.mockResolvedValue({ sourceRootId: 'root:proxy', sourceRelativePath: 'Proxy/A001.mp4' });

    await expect(applyRelinkMatch('a001', { kind: 'single', candidate: { name: 'A001.mp4', handle } } as never)).resolves.toBe(true);

    expect(mocks.resolveLocation).toHaveBeenCalledWith(handle);
    expect(mocks.store.getState().files[0]).toMatchObject({ sourceRootId: 'root:proxy', sourceRelativePath: 'Proxy/A001.mp4' });
  });

  it('keeps the scanned folder location of a candidate found in a source folder', async () => {
    const file = new File(['bytes'], 'A001.mp4');
    await applyRelinkMatch('a001', { kind: 'single', candidate: { name: 'A001.mp4', file, sourceRootId: 'root:drive', relativePath: 'MS UTE/A001.mp4' } } as never);

    expect(mocks.resolveLocation).not.toHaveBeenCalled();
    expect(mocks.store.getState().files[0]).toMatchObject({ sourceRootId: 'root:drive', sourceRelativePath: 'MS UTE/A001.mp4' });
  });
});
