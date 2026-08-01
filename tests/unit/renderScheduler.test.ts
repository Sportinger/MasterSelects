import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderSource } from '../../src/types/renderTarget';

type MockTimelineState = {
  playheadPosition: number;
  clips: unknown[];
};

type MockMediaState = {
  activeCompositionId: string | null;
  compositions: unknown[];
};

type MockRenderTargetState = {
  targets: Map<string, {
    id: string;
    source: RenderSource;
    enabled: boolean;
    viewportOverride?: { width: number; height: number; cameraOverride: null } | null;
  }>;
  resolveSourceToCompId: (source: RenderSource) => string | null;
};

const hoisted = vi.hoisted(() => ({
  timelineState: {
    playheadPosition: 0,
    clips: [],
  } as MockTimelineState,
  mediaState: {
    activeCompositionId: null,
    compositions: [],
  } as MockMediaState,
  renderTargetState: {
    targets: new Map(),
    resolveSourceToCompId: (source: RenderSource) => {
      if (source.type === 'composition') {
        return source.compositionId;
      }
      if (source.type === 'activeComp') return hoisted.mediaState.activeCompositionId;
      return null;
    },
  } as MockRenderTargetState,
  evaluateAtTime: vi.fn(() => []),
  prepareComposition: vi.fn(async () => true),
  copyNestedCompTextureToPreview: vi.fn(() => false),
  renderToPreviewCanvas: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => hoisted.timelineState,
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => hoisted.mediaState,
  },
}));

vi.mock('../../src/stores/renderTargetStore', () => ({
  useRenderTargetStore: {
    getState: () => hoisted.renderTargetState,
  },
}));

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: {
    isReady: vi.fn(() => true),
    prepareComposition: hoisted.prepareComposition,
    evaluateAtTime: hoisted.evaluateAtTime,
  },
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    getIsExporting: vi.fn(() => false),
    copyNestedCompTextureToPreview: hoisted.copyNestedCompTextureToPreview,
    renderToPreviewCanvas: hoisted.renderToPreviewCanvas,
  },
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    getIsExporting: vi.fn(() => false),
    copyNestedCompTextureToPreview: hoisted.copyNestedCompTextureToPreview,
    renderToPreviewCanvas: hoisted.renderToPreviewCanvas,
  },
}));

vi.mock('../../src/utils/renderTargetVisibility', () => ({
  isRenderTargetRenderable: vi.fn(() => true),
}));

import { normalizeIsolatedLayerPreview, renderScheduler } from '../../src/services/renderScheduler';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import type { Layer } from '../../src/types';

type RenderSchedulerTestAccess = typeof renderScheduler & {
  registeredTargets: Set<string>;
  preparedCompositions: Set<string>;
  preparingCompositions: Set<string>;
  nestedCompCache: Map<string, unknown>;
  nestedCompCacheTime: number;
  activeCompFrame: unknown | null;
  isRunning: boolean;
  startLoop: () => void;
  stopLoop: () => void;
  renderAllTargets: () => void;
};

describe('renderScheduler playback timing', () => {
  beforeEach(() => {
    hoisted.evaluateAtTime.mockClear();
    hoisted.prepareComposition.mockClear();
    hoisted.copyNestedCompTextureToPreview.mockClear();
    hoisted.copyNestedCompTextureToPreview.mockReturnValue(false);
    hoisted.renderToPreviewCanvas.mockClear();

    hoisted.timelineState = {
      playheadPosition: 0,
      clips: [],
    };
    hoisted.mediaState = {
      activeCompositionId: 'comp-1',
      compositions: [
        { id: 'comp-1', timelineData: { clips: [] } },
        { id: 'comp-2', timelineData: { clips: [], playheadPosition: 0 } },
      ],
    };
    hoisted.renderTargetState = {
      targets: new Map([
        ['preview-comp-2', {
          id: 'preview-comp-2',
          source: { type: 'composition', compositionId: 'comp-2' },
          enabled: true,
        }],
      ]),
      resolveSourceToCompId: (source: RenderSource) => {
        if (source.type === 'composition') {
          return source.compositionId;
        }
        if (source.type === 'activeComp') return hoisted.mediaState.activeCompositionId;
        return null;
      },
    };

    playheadState.position = 0;
    playheadState.isUsingInternalPosition = false;

    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    scheduler.registeredTargets.clear();
    scheduler.preparedCompositions.clear();
    scheduler.preparingCompositions.clear();
    scheduler.nestedCompCache.clear();
    scheduler.nestedCompCacheTime = 0;
    scheduler.activeCompFrame = null;
  });

  it('uses the high-frequency internal playhead for nested comp previews during playback', () => {
    hoisted.timelineState = {
      playheadPosition: 7,
      clips: [
        {
          id: 'nested-clip',
          isComposition: true,
          compositionId: 'comp-2',
          startTime: 5,
          duration: 10,
          inPoint: 2,
          outPoint: 12,
        },
      ],
    };

    playheadState.position = 8;
    playheadState.isUsingInternalPosition = true;

    (renderScheduler as unknown as RenderSchedulerTestAccess).registeredTargets.add('preview-comp-2');
    renderScheduler.forceRender();

    expect(hoisted.evaluateAtTime).toHaveBeenCalledWith('comp-2', 5);
    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-comp-2', [], {
      compositionId: 'comp-2',
      timelineTimeSeconds: 5,
    });
  });

  it('copies the exact nested wrapper occurrence into an independent preview', () => {
    hoisted.timelineState = {
      playheadPosition: 7,
      clips: [{
        id: 'nested-clip',
        isComposition: true,
        compositionId: 'comp-2',
        startTime: 5,
        duration: 10,
        inPoint: 2,
        outPoint: 12,
      }],
    };
    hoisted.copyNestedCompTextureToPreview.mockReturnValue(true);
    const wrapperLayer = {
      id: 'comp-1_layer_0_nested-clip',
      sourceClipId: 'nested-clip',
      source: {
        type: 'image',
        nestedComposition: { compositionId: 'comp-2' },
      },
    } as unknown as Layer;
    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    scheduler.registeredTargets.add('preview-comp-2');
    renderScheduler.setActiveCompLayers([wrapperLayer], {
      compositionId: 'comp-1',
      timelineTimeSeconds: 7,
    });

    renderScheduler.forceRender();

    expect(hoisted.copyNestedCompTextureToPreview).toHaveBeenCalledWith(
      'preview-comp-2',
      'comp-2',
      'comp-1_layer_0_nested-clip',
    );
    expect(hoisted.renderToPreviewCanvas).not.toHaveBeenCalled();
    expect(hoisted.evaluateAtTime).not.toHaveBeenCalled();
  });

  it('disables nested texture copy when the composition occurrence is ambiguous', () => {
    hoisted.timelineState = {
      playheadPosition: 7,
      clips: [{
        id: 'nested-clip-a',
        isComposition: true,
        compositionId: 'comp-2',
        startTime: 5,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
      }, {
        id: 'nested-clip-b',
        isComposition: true,
        compositionId: 'comp-2',
        startTime: 6,
        duration: 10,
        inPoint: 3,
        outPoint: 13,
      }],
    };
    hoisted.copyNestedCompTextureToPreview.mockReturnValue(true);
    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    scheduler.registeredTargets.add('preview-comp-2');
    renderScheduler.setActiveCompLayers([{
      id: 'wrapper-a',
      sourceClipId: 'nested-clip-a',
      source: { type: 'image', nestedComposition: { compositionId: 'comp-2' } },
    }, {
      id: 'wrapper-b',
      sourceClipId: 'nested-clip-b',
      source: { type: 'image', nestedComposition: { compositionId: 'comp-2' } },
    }] as unknown as Layer[], {
      compositionId: 'comp-1',
      timelineTimeSeconds: 7,
    });

    renderScheduler.forceRender();

    expect(hoisted.copyNestedCompTextureToPreview).not.toHaveBeenCalled();
    expect(hoisted.evaluateAtTime).toHaveBeenCalledWith('comp-2', 0);
    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-comp-2', [], {
      compositionId: 'comp-2',
      timelineTimeSeconds: 0,
    });
  });

  it('normalizes blend modes for isolated layer preview renders', () => {
    const original = [
      { id: 'normal-layer', blendMode: 'normal' },
      { id: 'screen-layer', blendMode: 'screen' },
    ] as Layer[];

    const normalized = normalizeIsolatedLayerPreview(original);

    expect(normalized[0]).toBe(original[0]);
    expect(normalized[1]).not.toBe(original[1]);
    expect(normalized[1].blendMode).toBe('normal');
  });

  it('renders an active-comp viewport override with the exact main-loop frame snapshot', () => {
    const layers = [{ id: 'active-layer', blendMode: 'screen' }] as Layer[];
    hoisted.renderTargetState.targets.set('preview-edit', {
      id: 'preview-edit',
      source: { type: 'activeComp' },
      enabled: true,
      viewportOverride: { width: 640, height: 480, cameraOverride: null },
    });
    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    scheduler.registeredTargets.add('preview-edit');
    renderScheduler.setActiveCompLayers(layers, {
      compositionId: 'comp-1',
      timelineTimeSeconds: 2.25,
    });

    // The playback clock can advance before the independent target is serviced.
    // Its reused layers still belong to the atomically captured 2.25s frame.
    playheadState.position = 8;
    playheadState.isUsingInternalPosition = true;

    renderScheduler.forceRender();

    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-edit', layers, {
      compositionId: 'comp-1',
      timelineTimeSeconds: 2.25,
    });
    expect(hoisted.renderToPreviewCanvas.mock.calls.at(-1)?.[1]).toBe(layers);
    expect(hoisted.evaluateAtTime).not.toHaveBeenCalled();
  });

  it('keeps scheduling frames when one independent target pass throws', () => {
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(20);
    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    const renderSpy = vi.spyOn(scheduler, 'renderAllTargets')
      .mockImplementationOnce(() => {
        throw new Error('target render failed');
      });

    try {
      scheduler.startLoop();
      expect(scheduledFrames).toHaveLength(1);

      scheduledFrames.shift()!(20);

      expect(renderSpy).toHaveBeenCalledOnce();
      expect(scheduler.isRunning).toBe(true);
      expect(scheduledFrames).toHaveLength(1);
    } finally {
      scheduler.stopLoop();
      renderSpy.mockRestore();
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
