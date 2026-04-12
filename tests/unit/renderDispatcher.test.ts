import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderDispatcher } from '../../src/engine/render/RenderDispatcher';
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
});
