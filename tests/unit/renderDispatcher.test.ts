import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderDispatcher } from '../../src/engine/render/RenderDispatcher';
import { waitForBasePreparedSplatRuntime, waitForTargetPreparedSplatRuntime } from '../../src/engine/three/splatRuntimeCache';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

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

vi.mock('../../src/services/performanceMonitor', () => ({
  reportRenderTime: vi.fn(),
}));

vi.mock('../../src/engine/three/splatRuntimeCache', () => ({
  waitForBasePreparedSplatRuntime: vi.fn(async () => ({})),
  waitForTargetPreparedSplatRuntime: vi.fn(async () => ({})),
}));

function createDispatcher(isPlaying = true) {
  const collect = vi.fn(() => []);
  const deps = {
    getDevice: vi.fn(() => ({})),
    isRecovering: vi.fn(() => false),
    sampler: {},
    previewContext: null,
    targetCanvases: new Map(),
    compositorPipeline: {
      beginFrame: vi.fn(),
    },
    outputPipeline: {},
    slicePipeline: null,
    textureManager: {},
    maskTextureManager: null,
    renderTargetManager: {
      getPingView: vi.fn(() => ({})),
      getPongView: vi.fn(() => ({})),
      getResolution: vi.fn(() => ({ width: 1920, height: 1080 })),
    },
    layerCollector: {
      collect,
      getDecoder: vi.fn(() => 'WebCodecs'),
      getWebCodecsInfo: vi.fn(() => undefined),
      hasActiveVideo: vi.fn(() => false),
    },
    compositor: {},
    nestedCompRenderer: null,
    cacheManager: {
      getScrubbingCache: vi.fn(() => null),
      getLastVideoTime: vi.fn(),
      setLastVideoTime: vi.fn(),
    },
    exportCanvasManager: {
      getIsExporting: vi.fn(() => false),
    },
    performanceStats: {
      setDecoder: vi.fn(),
      setWebCodecsInfo: vi.fn(),
      setLayerCount: vi.fn(),
    },
    renderLoop: {
      getIsPlaying: vi.fn(() => isPlaying),
      setHasActiveVideo: vi.fn(),
    },
  } as any;

  const dispatcher = new RenderDispatcher(deps);
  const renderEmptyFrame = vi
    .spyOn(dispatcher, 'renderEmptyFrame')
    .mockImplementation(() => {});
  const recordMainPreviewFrame = vi
    .spyOn(dispatcher as any, 'recordMainPreviewFrame')
    .mockImplementation(() => {});

  return {
    dispatcher,
    deps,
    collect,
    renderEmptyFrame,
    recordMainPreviewFrame,
  };
}

describe('RenderDispatcher empty playback hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMediaStore.setState({
      files: [],
    } as any);
    useTimelineStore.setState({
      isDraggingPlayhead: false,
      playheadPosition: 0,
      tracks: [],
      clips: [],
      getInterpolatedTransform: () => ({
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        opacity: 1,
        blendMode: 'normal',
      }),
    } as any);
  });

  it('keeps the last frame on small playback stalls with an empty layer set', () => {
    const { dispatcher, deps, renderEmptyFrame, recordMainPreviewFrame } = createDispatcher(true);

    dispatcher.lastRenderHadContent = true;
    (dispatcher as any).lastPreviewTargetTimeMs = 17_667;

    dispatcher.render([{
      id: 'layer-1',
      sourceClipId: 'clip-1',
      visible: true,
      opacity: 1,
      source: {
        type: 'video',
        mediaTime: 17.75,
      },
    } as any]);

    expect(renderEmptyFrame).not.toHaveBeenCalled();
    expect(recordMainPreviewFrame).not.toHaveBeenCalled();
    expect(deps.performanceStats.setLayerCount).toHaveBeenCalledWith(0);
    expect(dispatcher.lastRenderHadContent).toBe(true);
  });

  it('clears the stale preview canvas on large target jumps with empty layer data', () => {
    const { dispatcher, deps, renderEmptyFrame, recordMainPreviewFrame } = createDispatcher(true);

    dispatcher.lastRenderHadContent = true;
    (dispatcher as any).lastPreviewTargetTimeMs = 17_667;

    dispatcher.render([{
      id: 'layer-1',
      sourceClipId: 'clip-1',
      visible: true,
      opacity: 1,
      source: {
        type: 'video',
        mediaTime: 8.02,
      },
    } as any]);

    expect(renderEmptyFrame).toHaveBeenCalledTimes(1);
    expect(recordMainPreviewFrame).toHaveBeenCalledWith('empty', undefined, {
      clipId: 'clip-1',
      targetTimeMs: 8020,
    });
    expect(deps.performanceStats.setLayerCount).toHaveBeenCalledWith(0);
    expect(dispatcher.lastRenderHadContent).toBe(false);
  });

  it('uses the export render-time override for active splat effectors', () => {
    const { dispatcher } = createDispatcher(false);

    useTimelineStore.setState({
      playheadPosition: 0,
      tracks: [{
        id: 'track-1',
        type: 'video',
        visible: true,
      }],
      clips: [{
        id: 'effector-1',
        trackId: 'track-1',
        startTime: 5,
        duration: 2,
        source: {
          type: 'splat-effector',
          splatEffectorSettings: {
            mode: 'swirl',
            strength: 55,
            falloff: 1.2,
            speed: 2,
            seed: 7,
          },
        },
      }],
      getInterpolatedTransform: () => ({
        position: { x: 0.25, y: -0.5, z: 3 },
        scale: { x: 0.4, y: 0.6, z: 0.8 },
        rotation: { x: 10, y: 20, z: 30 },
        opacity: 1,
        blendMode: 'normal',
      }),
    } as any);

    expect((dispatcher as any).collectActiveSplatEffectors(1920, 1080)).toHaveLength(0);

    dispatcher.setRenderTimeOverride(5.5);
    const effectors = (dispatcher as any).collectActiveSplatEffectors(1920, 1080);

    expect(effectors).toHaveLength(1);
    expect(effectors[0]).toMatchObject({
      clipId: 'effector-1',
      mode: 'swirl',
      strength: 55,
      falloff: 1.2,
      speed: 2,
      seed: 7,
      time: 0.5,
      position: {
        x: 0.4444444444444444,
        y: 0.5,
        z: 3,
      },
      rotation: {
        x: 10,
        y: 20,
        z: 30,
      },
      scale: {
        x: 0.4,
        y: 0.6,
        z: 0.8,
      },
      radius: 0.8,
    });
  });

  it('waits for nested 3D and splat assets before precise export rendering', async () => {
    const { dispatcher, deps } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadThreeModelAsset').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    await dispatcher.ensureExportLayersReady([
      {
        id: 'native-splat',
        name: 'Native Splat',
        sourceClipId: 'native-splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:native-splat',
          gaussianSplatFileName: 'native.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
        },
      },
      {
        id: 'nested-comp',
        name: 'Nested Comp',
        visible: true,
        opacity: 1,
        source: {
          type: 'image',
          nestedComposition: {
            compositionId: 'comp-1',
            width: 1920,
            height: 1080,
            layers: [
              {
                id: 'nested-model',
                name: 'Hero Model',
                visible: true,
                opacity: 1,
                is3D: true,
                source: {
                  type: 'model',
                  modelUrl: 'blob:model-1',
                },
              },
              {
                id: 'nested-splat',
                name: 'Nested Splat',
                visible: true,
                opacity: 1,
                is3D: true,
                source: {
                  type: 'gaussian-splat',
                  gaussianSplatUrl: 'blob:media-splat',
                  gaussianSplatFileName: 'media-backed.splat',
                  gaussianSplatFileHash: 'media-hash-1',
                  gaussianSplatSettings: {
                    render: {
                      useNativeRenderer: false,
                      maxSplats: 0,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ] as any);

    expect(dispatcher.ensureThreeSceneRendererInitialized).toHaveBeenCalledWith(1920, 1080);
    expect(dispatcher.preloadThreeModelAsset).toHaveBeenCalledWith('blob:model-1', 'Hero Model');
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledWith(
      'native-splat',
      'blob:native-splat',
      'native.splat',
    );
    expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'media-hash-1',
        fileHash: 'media-hash-1',
        fileName: 'media-backed.splat',
        url: 'blob:media-splat',
        requestedMaxSplats: 0,
      }),
    );
    expect(deps.renderTargetManager.getResolution).toHaveBeenCalled();
  });

  it('waits for base three.js splat runtimes for sequence layers during precise export', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);

    await dispatcher.ensureExportLayersReady([
      {
        id: 'three-sequence',
        name: 'Three Sequence',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:sequence-frame-1',
          gaussianSplatFileName: 'frame_0001.ply',
          gaussianSplatSequence: {
            frameCount: 2,
            fps: 24,
            frames: [],
          },
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: false,
              maxSplats: 0,
            },
          },
        },
      },
    ] as any);

    expect(waitForBasePreparedSplatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'frame_0001.ply|blob:sequence-frame-1',
        fileHash: undefined,
        fileName: 'frame_0001.ply',
        url: 'blob:sequence-frame-1',
        requestedMaxSplats: 0,
      }),
    );
    expect(waitForTargetPreparedSplatRuntime).not.toHaveBeenCalled();
  });

  it('does not collapse sequence export readiness to mediaFileId across different frame runtimes', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);

    const makeLayer = (runtimeKey: string, url: string) => ({
      id: `three-sequence-${runtimeKey}`,
      name: 'Three Sequence',
      visible: true,
      opacity: 1,
      is3D: true,
      source: {
        type: 'gaussian-splat',
        mediaFileId: 'media-sequence-1',
        gaussianSplatUrl: url,
        gaussianSplatFileName: 'frame_0001.ply',
        gaussianSplatRuntimeKey: runtimeKey,
        gaussianSplatSequence: {
          frameCount: 2,
          fps: 24,
          frames: [],
        },
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
            maxSplats: 0,
          },
        },
      },
    });

    await dispatcher.ensureExportLayersReady([makeLayer('sequence/frame-0001', 'blob:sequence-frame-1')] as any);
    await dispatcher.ensureExportLayersReady([makeLayer('sequence/frame-0002', 'blob:sequence-frame-2')] as any);

    expect(waitForBasePreparedSplatRuntime).toHaveBeenCalledTimes(2);
    expect(waitForBasePreparedSplatRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cacheKey: 'sequence/frame-0001',
        url: 'blob:sequence-frame-1',
      }),
    );
    expect(waitForBasePreparedSplatRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cacheKey: 'sequence/frame-0002',
        url: 'blob:sequence-frame-2',
      }),
    );
  });

  it('fails precise export when a required asset does not become ready', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadThreeModelAsset').mockResolvedValue(false);

    await expect(dispatcher.ensureExportLayersReady([
      {
        id: 'model-layer',
        name: 'Broken Model',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'model',
          modelUrl: 'blob:broken-model',
        },
      },
    ] as any)).rejects.toThrow('Precise export asset wait failed: 3D model "Broken Model" was not ready in time');
  });

  it('reuses export readiness cache for repeated frames with the same assets', async () => {
    const { dispatcher } = createDispatcher(false);

    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'preloadThreeModelAsset').mockResolvedValue(true);
    vi.spyOn(dispatcher, 'ensureGaussianSplatSceneLoaded').mockResolvedValue(true);

    const layers = [
      {
        id: 'native-splat',
        name: 'Native Splat',
        sourceClipId: 'native-splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:native-splat',
          gaussianSplatFileName: 'native.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
            },
          },
        },
      },
      {
        id: 'model-layer',
        name: 'Hero Model',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'model',
          modelUrl: 'blob:model-1',
        },
      },
      {
        id: 'three-splat',
        name: 'Three Splat',
        visible: true,
        opacity: 1,
        is3D: true,
        source: {
          type: 'gaussian-splat',
          gaussianSplatUrl: 'blob:three-splat',
          gaussianSplatFileHash: 'three-hash',
          gaussianSplatFileName: 'three.splat',
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: false,
              maxSplats: 0,
            },
          },
        },
      },
    ] as any;

    await dispatcher.ensureExportLayersReady(layers);
    await dispatcher.ensureExportLayersReady(layers);

    expect(dispatcher.ensureThreeSceneRendererInitialized).toHaveBeenCalledTimes(1);
    expect(dispatcher.preloadThreeModelAsset).toHaveBeenCalledTimes(1);
    expect(dispatcher.ensureGaussianSplatSceneLoaded).toHaveBeenCalledTimes(1);
    expect(waitForTargetPreparedSplatRuntime).toHaveBeenCalledTimes(1);
  });
});
