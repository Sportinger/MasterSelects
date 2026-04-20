import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPreparedSplatRuntimeSync: vi.fn(),
  waitForBasePreparedSplatRuntime: vi.fn(),
  waitForTargetPreparedSplatRuntime: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: mocks.loggerWarn,
      error: vi.fn(),
    })),
  },
}));

vi.mock('../../src/engine/three/splatRuntimeCache', () => ({
  getPreparedSplatRuntimeSync: mocks.getPreparedSplatRuntimeSync,
  waitForBasePreparedSplatRuntime: mocks.waitForBasePreparedSplatRuntime,
  waitForTargetPreparedSplatRuntime: mocks.waitForTargetPreparedSplatRuntime,
}));

vi.mock('../../src/stores/renderTargetStore', () => ({
  useRenderTargetStore: {
    getState: () => ({}),
  },
}));

vi.mock('../../src/stores/sliceStore', () => ({
  useSliceStore: {
    getState: () => ({}),
  },
}));

vi.mock('../../src/stores/engineStore', () => ({
  useEngineStore: {
    getState: () => ({}),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      playheadPosition: 0,
      clips: [],
      tracks: [],
    }),
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  DEFAULT_SCENE_CAMERA_SETTINGS: {
    fov: 50,
    near: 0.1,
    far: 1000,
  },
  useMediaStore: {
    getState: () => ({
      files: [],
    }),
  },
}));

import { RenderDispatcher } from '../../src/engine/render/RenderDispatcher';

function createDispatcher(): RenderDispatcher {
  return new RenderDispatcher({
    getDevice: () => null,
    isRecovering: () => false,
    sampler: null,
    previewContext: null,
    targetCanvases: new Map(),
    compositorPipeline: null,
    outputPipeline: null,
    slicePipeline: null,
    textureManager: null,
    maskTextureManager: null,
    renderTargetManager: {
      getResolution: () => ({ width: 1920, height: 1080 }),
    },
    layerCollector: null,
    compositor: null,
    nestedCompRenderer: null,
    cacheManager: {} as any,
    exportCanvasManager: {} as any,
    performanceStats: {} as any,
    renderLoop: null,
    threeSceneRenderer: null,
  } as any);
}

function createThreeSplatLayer() {
  return [
    {
      id: 'layer-splat',
      name: 'Hero Splat',
      visible: true,
      opacity: 1,
      is3D: true,
      sourceClipId: 'clip-splat',
      source: {
        type: 'gaussian-splat',
        gaussianSplatUrl: 'blob:hero-splat',
        gaussianSplatFileName: 'hero.ply',
        file: new File([new Uint8Array([1, 2, 3])], 'hero.ply', {
          type: 'application/octet-stream',
        }),
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: false,
            maxSplats: 0,
          },
        },
      },
    },
  ] as any;
}

describe('RenderDispatcher.ensureExportLayersReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPreparedSplatRuntimeSync.mockReturnValue(null);
    mocks.waitForBasePreparedSplatRuntime.mockResolvedValue({});
    mocks.waitForTargetPreparedSplatRuntime.mockResolvedValue({});
  });

  it('falls back to a cached base three.js splat runtime when the full export runtime cannot be allocated', async () => {
    const dispatcher = createDispatcher();
    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);

    mocks.waitForTargetPreparedSplatRuntime.mockRejectedValueOnce(new Error('Array buffer allocation failed'));
    mocks.getPreparedSplatRuntimeSync.mockReturnValueOnce({
      runtimeKey: 'cached-base-runtime',
    });

    await expect(dispatcher.ensureExportLayersReady(createThreeSplatLayer())).resolves.toBeUndefined();

    expect(mocks.waitForTargetPreparedSplatRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.waitForBasePreparedSplatRuntime).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Precise export falling back to cached base Three.js splat runtime',
      expect.objectContaining({
        fileName: 'hero.ply',
      }),
    );
  });

  it('rebuilds the base runtime once and caches export readiness after a recoverable target runtime failure', async () => {
    const dispatcher = createDispatcher();
    vi.spyOn(dispatcher, 'ensureThreeSceneRendererInitialized').mockResolvedValue(true);

    mocks.waitForTargetPreparedSplatRuntime.mockRejectedValueOnce(new Error('Array buffer allocation failed'));

    await expect(dispatcher.ensureExportLayersReady(createThreeSplatLayer())).resolves.toBeUndefined();
    await expect(dispatcher.ensureExportLayersReady(createThreeSplatLayer())).resolves.toBeUndefined();

    expect(mocks.waitForTargetPreparedSplatRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.waitForBasePreparedSplatRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Precise export falling back to rebuilt base Three.js splat runtime',
      expect.objectContaining({
        fileName: 'hero.ply',
      }),
    );
  });
});
