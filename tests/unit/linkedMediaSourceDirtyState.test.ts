import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const mediaState = {
    files: [] as Array<{
      id: string;
      linkedSources?: Array<{ id: string }>;
      sourceSelection?: { mode: 'auto' | 'original' } | { mode: 'linked'; sourceId: string };
    }>,
  };
  return {
    mediaState,
    markDirty: vi.fn(),
    getLinked: vi.fn(),
    getStoredHandle: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => mocks.mediaState,
    setState: (updater: (state: typeof mocks.mediaState) => typeof mocks.mediaState) => {
      const next = updater(mocks.mediaState);
      if (next !== mocks.mediaState) Object.assign(mocks.mediaState, next);
    },
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({ clips: [], updateClip: vi.fn() }),
  },
}));

vi.mock('../../src/services/mediaRuntime/linkedMediaSourceRuntime', () => ({
  linkedMediaSourceRuntime: {
    getActive: vi.fn(),
    getOriginal: vi.fn(),
    getLinked: mocks.getLinked,
    rememberOriginal: vi.fn(),
    setOriginal: vi.fn(),
    setLinked: vi.fn(),
    setActive: vi.fn(),
    clearActive: vi.fn(),
  },
}));

vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  releaseClipSourceRuntime: vi.fn(),
}));

vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: {
    getFileHandle: vi.fn(),
    storeFileHandle: vi.fn(),
  },
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: mocks.getStoredHandle,
    storeHandle: vi.fn(),
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => true,
    markDirty: mocks.markDirty,
  },
}));

vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  createPrimaryMediaObjectUrl: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore/slices/fileManageSlice', () => ({
  updateTimelineClips: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore/helpers/mediaInfoHelpers', () => ({
  getMediaInfo: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore/helpers/thumbnailHelpers', () => ({
  createThumbnail: vi.fn(),
}));

describe('linked media source dirty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mediaState.files = [{
      id: 'media-1',
      linkedSources: [{ id: 'source-1' }],
      sourceSelection: { mode: 'linked', sourceId: 'source-1' },
    }];
  });

  it('does not treat post-load runtime restoration as a project edit', async () => {
    const { restoreSelectedMediaSource } = await import('../../src/services/project/linkedMediaSources');
    const filesBeforeRestore = mocks.mediaState.files;

    await expect(restoreSelectedMediaSource('media-1')).resolves.toBe(false);

    expect(mocks.markDirty).not.toHaveBeenCalled();
    expect(mocks.mediaState.files).toBe(filesBeforeRestore);
  });

  it('does not mark an unchanged user source selection dirty', async () => {
    const { selectMediaSource } = await import('../../src/services/project/linkedMediaSources');

    await expect(selectMediaSource('media-1', { mode: 'linked', sourceId: 'source-1' })).resolves.toBe(false);

    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('treats an omitted selection as the unchanged auto default', async () => {
    const { selectMediaSource } = await import('../../src/services/project/linkedMediaSources');
    mocks.mediaState.files[0]!.sourceSelection = undefined;

    await expect(selectMediaSource('media-1', { mode: 'auto' })).resolves.toBe(true);

    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('keeps a changed user source selection persisted and dirty when relinking fails', async () => {
    const { selectMediaSource } = await import('../../src/services/project/linkedMediaSources');
    mocks.mediaState.files[0]!.linkedSources!.push({ id: 'source-2' });

    await expect(selectMediaSource('media-1', { mode: 'linked', sourceId: 'source-2' })).resolves.toBe(false);

    expect(mocks.mediaState.files[0]?.sourceSelection).toEqual({ mode: 'linked', sourceId: 'source-2' });
    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
  });
});
