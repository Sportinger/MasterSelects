import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preload3DAssetsForExport, preloadGaussianSplatsForExport } from '../../src/engine/export/preloadGaussianSplats';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { engine } from '../../src/engine/WebGPUEngine';

type MediaStorePatch = Parameters<typeof useMediaStore.setState>[0];
type TimelineStorePatch = Parameters<typeof useTimelineStore.setState>[0];
type MediaStoreState = ReturnType<typeof useMediaStore.getState>;

const asTimelinePatch = (state: unknown): TimelineStorePatch => state as TimelineStorePatch;
const asMediaState = (state: unknown): MediaStoreState => state as MediaStoreState;

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    ensureGaussianSplatSceneLoaded: vi.fn(async () => true),
    ensureSceneRendererInitialized: vi.fn(async () => true),
    preloadSceneModelAsset: vi.fn(async () => true),
  },
}));

describe('export asset preload helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMediaStore.setState({
      files: [],
      compositions: [],
    } as MediaStorePatch);
    useTimelineStore.setState({
      tracks: [
        {
          id: 'track-1',
          type: 'video',
          visible: true,
          solo: false,
        },
      ],
      clips: [],
    } as TimelineStorePatch);
  });

  it('preloads native gaussian splats that overlap the export range', async () => {
    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'splat-in-range',
          name: 'Splat In Range',
          trackId: 'track-1',
          startTime: 1,
          duration: 4,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat-in-range',
            gaussianSplatFileName: 'hero.splat',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
        {
          id: 'splat-out-of-range',
          name: 'Splat Out Of Range',
          trackId: 'track-1',
          startTime: 8,
          duration: 2,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat-out-of-range',
            gaussianSplatFileName: 'late.splat',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
      ],
    }));

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(1);
    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'splat-in-range',
        clipId: 'splat-in-range',
        url: 'blob:splat-in-range',
        fileName: 'hero.splat',
        showProgress: false,
      }),
    );
  });

  it('preloads gaussian splats through the native scene loader even for legacy false clips', async () => {
    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'splat-three',
          name: 'Three Splat',
          trackId: 'track-1',
          file: { name: 'hero.splat' },
          startTime: 1,
          duration: 4,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat-three',
            gaussianSplatFileName: 'hero.splat',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
              },
            },
          },
        },
      ],
    }));

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(1);
    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'splat-three',
        clipId: 'splat-three',
        url: 'blob:splat-three',
        fileName: 'hero.splat',
      }),
    );
  });

  it('preloads gaussian splat sequences through the native scene loader without a Three fallback', async () => {
    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'splat-sequence',
          name: 'Sequence Splat',
          trackId: 'track-1',
          file: { name: 'hero_0001.ply' },
          startTime: 1,
          duration: 4,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat-sequence-frame-1',
            gaussianSplatFileName: 'hero_0001.ply',
            gaussianSplatSequence: {
              frameCount: 2,
              fps: 24,
              sharedBounds: {
                min: [-1, -1, -1],
                max: [1, 1, 1],
              },
              frames: [],
            },
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
              },
            },
          },
        },
      ],
    }));

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(1);
    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'splat-sequence',
        clipId: 'splat-sequence',
        url: 'blob:splat-sequence-frame-1',
        fileName: 'hero_0001.ply',
        showProgress: false,
      }),
    );
  });

  it('preloads native gaussian splat sequence scenes by per-frame runtime key', async () => {
    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'splat-sequence-native',
          name: 'Native Sequence',
          trackId: 'track-1',
          file: { name: 'hero_0002.ply' },
          startTime: 1,
          duration: 4,
          source: {
            type: 'gaussian-splat',
            gaussianSplatUrl: 'blob:splat-sequence-frame-2',
            gaussianSplatFileName: 'hero_0002.ply',
            gaussianSplatRuntimeKey: 'Raw/hero_0002.ply',
            gaussianSplatSequence: {
              frameCount: 2,
              fps: 24,
              frames: [],
            },
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: true,
              },
            },
          },
        },
      ],
    }));

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'Raw/hero_0002.ply',
        clipId: 'splat-sequence-native',
        url: 'blob:splat-sequence-frame-2',
        fileName: 'hero_0002.ply',
      }),
    );
  });

  it('initializes the 3D renderer and preloads overlapping model assets', async () => {
    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'model-in-range',
          name: 'Model In Range',
          trackId: 'track-1',
          file: { name: 'scene.glb' },
          is3D: true,
          startTime: 0,
          duration: 6,
          source: {
            type: 'model',
            modelUrl: 'blob:model-in-range',
          },
        },
        {
          id: 'plane-in-range',
          name: 'Plane In Range',
          trackId: 'track-1',
          is3D: true,
          startTime: 1,
          duration: 3,
          source: {
            type: 'image',
          },
        },
        {
          id: 'model-out-of-range',
          name: 'Model Out Of Range',
          trackId: 'track-1',
          file: { name: 'late.glb' },
          is3D: true,
          startTime: 9,
          duration: 2,
          source: {
            type: 'model',
            modelUrl: 'blob:model-out-of-range',
          },
        },
      ],
    }));

    await preload3DAssetsForExport({
      startTime: 0,
      endTime: 5,
      width: 1920,
      height: 1080,
    });

    expect(engine.ensureSceneRendererInitialized).toHaveBeenCalledTimes(1);
    expect(engine.ensureSceneRendererInitialized).toHaveBeenCalledWith(1920, 1080);
    expect(engine.preloadSceneModelAsset).toHaveBeenCalledTimes(1);
    expect(engine.preloadSceneModelAsset).toHaveBeenCalledWith(
      'blob:model-in-range',
      'scene.glb',
    );
  });

  it('recursively preloads nested export assets and ignores zero-byte placeholder splat files', async () => {
    useTimelineStore.setState(asTimelinePatch({
      tracks: [
        {
          id: 'track-1',
          type: 'video',
          visible: true,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'comp-clip',
          name: 'Comp Clip',
          trackId: 'track-1',
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          isComposition: true,
          nestedTracks: [
            {
              id: 'nested-track-1',
              type: 'video',
              visible: true,
              solo: false,
            },
            {
              id: 'nested-track-2',
              type: 'video',
              visible: true,
              solo: false,
            },
          ],
          nestedClips: [
            {
              id: 'nested-splat',
              name: 'Nested Splat',
              trackId: 'nested-track-1',
              file: { name: 'nested.splat', size: 0 },
              startTime: 0,
              duration: 5,
              source: {
                type: 'gaussian-splat',
                gaussianSplatUrl: 'blob:nested-splat',
                gaussianSplatFileName: 'nested.splat',
                gaussianSplatFileHash: 'nested-hash',
                gaussianSplatSettings: {
                  render: {
                    useNativeRenderer: false,
                  },
                },
              },
            },
            {
              id: 'nested-model',
              name: 'Nested Model',
              trackId: 'nested-track-2',
              file: { name: 'nested.glb' },
              is3D: true,
              startTime: 0,
              duration: 5,
              source: {
                type: 'model',
                modelUrl: 'blob:nested-model',
              },
            },
          ],
          source: {
            type: 'image',
          },
        },
      ],
    }));

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });
    await preload3DAssetsForExport({
      startTime: 0,
      endTime: 5,
      width: 1920,
      height: 1080,
    });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneKey: 'nested-splat',
        clipId: 'nested-splat',
        file: undefined,
        url: 'blob:nested-splat',
        fileName: 'nested.splat',
      }),
    );
    expect(engine.preloadSceneModelAsset).toHaveBeenCalledWith(
      'blob:nested-model',
      'nested.glb',
    );
  });

  it('uses media file hashes for export splat preloading when clip source metadata is incomplete', async () => {
    const mediaStateSpy = vi.spyOn(useMediaStore, 'getState').mockReturnValue(asMediaState({
      ...useMediaStore.getState(),
      files: [
        {
          id: 'media-splat-1',
          name: 'media-hero.splat',
          type: 'gaussian-splat',
          fileHash: 'media-hash-1',
          file: { name: 'media-hero.splat', size: 1234 },
          url: 'blob:media-splat',
          parentId: null,
          createdAt: Date.now(),
        },
      ],
    }));

    useTimelineStore.setState(asTimelinePatch({
      clips: [
        {
          id: 'splat-media-backed',
          name: 'Media Backed Splat',
          trackId: 'track-1',
          mediaFileId: 'media-splat-1',
          file: { name: 'placeholder.splat', size: 0 },
          startTime: 0,
          duration: 4,
          source: {
            type: 'gaussian-splat',
            mediaFileId: 'media-splat-1',
            gaussianSplatUrl: 'blob:media-splat',
            gaussianSplatSettings: {
              render: {
                useNativeRenderer: false,
              },
            },
          },
        },
      ],
    }));

    try {
      await preloadGaussianSplatsForExport({ startTime: 0, endTime: 4 });

      expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneKey: 'splat-media-backed',
          clipId: 'splat-media-backed',
          file: expect.objectContaining({
            name: 'media-hero.splat',
          }),
          fileName: 'media-hero.splat',
          url: 'blob:media-splat',
        }),
      );
    } finally {
      mediaStateSpy.mockRestore();
    }
  });
});
