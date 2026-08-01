import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { Layer } from '../../src/types';

const hoisted = vi.hoisted(() => ({
  timelineState: {
    isPlaying: true,
    isDraggingPlayhead: false,
    playheadPosition: 1,
    clipDragPreview: null,
    layerTransformPreview: null,
    maskEditPreview: null,
    maskDragging: false,
    playbackWarmup: null,
    clips: [],
    tracks: [],
    clipKeyframes: new Map(),
    isRamPreviewing: false,
    ramPreviewEnabled: false,
    addCachedFrame: vi.fn(),
  },
  mediaState: {
    activeCompositionId: 'comp-exact',
    compositions: [{ id: 'comp-exact', frameRate: 60 }],
  },
  getPlayheadPosition: vi.fn(),
  captureFrameContext: vi.fn(),
  syncVideoElements: vi.fn(),
  buildLayersFromStore: vi.fn(),
  syncAudioElements: vi.fn(),
  setActiveCompLayers: vi.fn(),
  render: vi.fn(),
  renderLoopCallback: null as (() => void) | null,
}));

vi.mock('../../src/stores/engineStore', () => ({
  useEngineStore: (selector: (state: { isEngineReady: boolean }) => unknown) => selector({ isEngineReady: true }),
}));

vi.mock('../../src/stores/timeline', () => {
  const useTimelineStore = Object.assign(
    (selector: (state: typeof hoisted.timelineState) => unknown) => selector(hoisted.timelineState),
    { getState: () => hoisted.timelineState },
  );
  return { useTimelineStore };
});

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => hoisted.mediaState,
  },
}));

vi.mock('../../src/services/layerBuilder', () => ({
  getPlayheadPosition: (...args: unknown[]) => hoisted.getPlayheadPosition(...args),
  layerBuilder: {
    captureFrameContext: (...args: unknown[]) => hoisted.captureFrameContext(...args),
    syncVideoElements: (...args: unknown[]) => hoisted.syncVideoElements(...args),
    buildLayersFromStore: (...args: unknown[]) => hoisted.buildLayersFromStore(...args),
    syncAudioElements: (...args: unknown[]) => hoisted.syncAudioElements(...args),
  },
}));

vi.mock('../../src/services/layerPlaybackManager', () => ({
  layerPlaybackManager: { hasActiveLayers: () => false },
}));

vi.mock('../../src/services/renderScheduler', () => ({
  renderScheduler: {
    setActiveCompLayers: (...args: unknown[]) => hoisted.setActiveCompLayers(...args),
  },
}));

vi.mock('../../src/services/framePhaseMonitor', () => ({
  framePhaseMonitor: { record: vi.fn() },
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: () => ({ error: vi.fn() }),
  },
}));

vi.mock('../../src/services/timeline/timelineVisualDemand', () => ({
  hasActiveTimelineVisualClip: () => true,
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    initialize: vi.fn(async () => true),
    setPreviewCanvas: vi.fn(),
    setVisualTargetFps: vi.fn(),
    setTimelineVisualDemand: vi.fn(),
    setIsScrubbing: vi.fn(),
    setContinuousRender: vi.fn(),
    requestRender: vi.fn(),
    renderCachedFrame: vi.fn(() => false),
    render: (...args: unknown[]) => hoisted.render(...args),
    cacheCompositeFrame: vi.fn(async () => undefined),
    cacheActiveCompOutput: vi.fn(),
    startStatsAndWatchdog: vi.fn(() => vi.fn()),
    startRenderLoop: vi.fn((callback: () => void) => {
      hoisted.renderLoopCallback = callback;
    }),
  },
}));

vi.mock('../../src/hooks/engine/engineTimelineDerivations', () => ({
  hasActiveContinuousRenderClip: () => false,
  hasContinuousRenderLayers: () => false,
}));

vi.mock('../../src/hooks/engine/useEngineMaskTextureSync', () => ({
  useEngineMaskTextureSync: () => vi.fn(),
}));

vi.mock('../../src/hooks/engine/useEngineRenderWakeSubscriptions', () => ({
  useEngineRenderWakeSubscriptions: vi.fn(),
}));

vi.mock('../../src/hooks/engine/useEngineResolutionSync', () => ({
  useEngineResolutionSync: vi.fn(),
}));

vi.mock('../../src/hooks/engine/useEngineTimelineStateSync', () => ({
  useEngineTimelineStateSync: vi.fn(),
}));

import { useEngine } from '../../src/hooks/useEngine';

describe('useEngine exact producer frame context', () => {
  afterEach(() => {
    vi.clearAllMocks();
    hoisted.renderLoopCallback = null;
  });

  it('uses one captured time for video sync, layer evaluation, scheduler, and render host', () => {
    const layers = [{ id: 'motion-layer' }] as Layer[];
    const layerFrameContext = {
      activeCompId: 'comp-exact',
      compositionById: new Map([['comp-exact', { id: 'comp-exact' }]]),
      playheadPosition: 2.5,
      isPlaying: true,
    } as FrameContext;
    hoisted.getPlayheadPosition
      .mockReturnValueOnce(2.5)
      .mockReturnValue(9.5);
    hoisted.captureFrameContext.mockReturnValue(layerFrameContext);
    hoisted.buildLayersFromStore.mockReturnValue(layers);

    const hook = renderHook(() => useEngine());
    expect(hoisted.renderLoopCallback).not.toBeNull();
    hoisted.renderLoopCallback?.();

    expect(hoisted.getPlayheadPosition).toHaveBeenCalledTimes(1);
    expect(hoisted.captureFrameContext).toHaveBeenCalledWith(2.5);
    expect(hoisted.syncVideoElements).toHaveBeenCalledWith(layerFrameContext);
    expect(hoisted.buildLayersFromStore).toHaveBeenCalledWith(layerFrameContext);

    const schedulerContext = hoisted.setActiveCompLayers.mock.calls[0]?.[1];
    const renderContext = hoisted.render.mock.calls[0]?.[1];
    expect(schedulerContext).toBe(renderContext);
    expect(schedulerContext).toEqual({
      compositionId: 'comp-exact',
      timelineTimeSeconds: 2.5,
    });
    expect(hoisted.setActiveCompLayers).toHaveBeenCalledWith(layers, schedulerContext);
    expect(hoisted.render).toHaveBeenCalledWith(layers, schedulerContext);

    hook.unmount();
  });
});
