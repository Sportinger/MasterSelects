import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preload3DAssetsForExport, preloadGaussianSplatsForExport } from '../../src/engine/export/preloadGaussianSplats';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { engine } from '../../src/engine/WebGPUEngine';
import { waitForTargetPreparedSplatRuntime } from '../../src/engine/three/splatRuntimeCache';

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
    ensureThreeSceneRendererInitialized: vi.fn(async () => true),
    preloadThreeModelAsset: vi.fn(async () => true),
  },
}));

vi.mock('../../src/engine/three/splatRuntimeCache', () => ({
  waitForTargetPreparedSplatRuntime: vi.fn(async () => ({})),
}));

describe('export asset preload helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMediaStore.setState({
      files: [],
      compositions: [],
    } as any);
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
    } as any);
  });

  it('preloads native gaussian splats that overlap the export range', async () => {
    useTimelineStore.setState({
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
    } as any);

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(1);
    expect(engine.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      'splat-in-range',
      'blob:splat-in-range',
      'hero.splat',
    );
    expect(waitForTargetPreparedSplatRuntime).not.toHaveBeenCalled();
  });

  it('preloads full three.js gaussian splat runtimes for non-native export clips', async () => {
    useTimelineStore.setState({
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
    } as any);

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });

    expect(engine.ensureThreeSceneRendererInitialized).toHaveBeenCalledWith(1, 1);
    expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledTimes(1);
    expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'hero.splat|blob:splat-three',
        url: 'blob:splat-three',
        fileName: 'hero.splat',
        requestedMaxSplats: 0,
      }),
    );
  });

  it('initializes the 3D renderer and preloads overlapping model assets', async () => {
    useTimelineStore.setState({
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
    } as any);

    await preload3DAssetsForExport({
      startTime: 0,
      endTime: 5,
      width: 1920,
      height: 1080,
    });

    expect(engine.ensureThreeSceneRendererInitialized).toHaveBeenCalledTimes(1);
    expect(engine.ensureThreeSceneRendererInitialized).toHaveBeenCalledWith(1920, 1080);
    expect(engine.preloadThreeModelAsset).toHaveBeenCalledTimes(1);
    expect(engine.preloadThreeModelAsset).toHaveBeenCalledWith(
      'blob:model-in-range',
      'scene.glb',
    );
  });

  it('recursively preloads nested export assets and ignores zero-byte placeholder splat files', async () => {
    useTimelineStore.setState({
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
    } as any);

    await preloadGaussianSplatsForExport({ startTime: 0, endTime: 5 });
    await preload3DAssetsForExport({
      startTime: 0,
      endTime: 5,
      width: 1920,
      height: 1080,
    });

    expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'nested-hash',
        file: undefined,
        url: 'blob:nested-splat',
        fileName: 'nested.splat',
        requestedMaxSplats: 0,
      }),
    );
    expect(engine.preloadThreeModelAsset).toHaveBeenCalledWith(
      'blob:nested-model',
      'nested.glb',
    );
  });

  it('uses media file hashes for export splat preloading when clip source metadata is incomplete', async () => {
    const mediaStateSpy = vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      ...(useMediaStore.getState() as any),
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
    } as any);

    useTimelineStore.setState({
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
    } as any);

    try {
      await preloadGaussianSplatsForExport({ startTime: 0, endTime: 4 });

      expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: 'media-hash-1',
          fileHash: 'media-hash-1',
          fileName: 'media-hero.splat',
          url: 'blob:media-splat',
        }),
      );
    } finally {
      mediaStateSpy.mockRestore();
    }
  });
});
