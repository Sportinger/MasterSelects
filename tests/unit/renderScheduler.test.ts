import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  timelineState: {
    playheadPosition: 0,
    clips: [],
  } as any,
  mediaState: {
    activeCompositionId: null,
    compositions: [],
  } as any,
  renderTargetState: {
    targets: new Map(),
    resolveSourceToCompId: (source: any) => {
      if (source.type === 'composition') {
        return source.compositionId;
      }
      return null;
    },
  } as any,
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

vi.mock('../../src/utils/renderTargetVisibility', () => ({
  isRenderTargetRenderable: vi.fn(() => true),
}));

import { renderScheduler } from '../../src/services/renderScheduler';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';

describe('renderScheduler playback timing', () => {
  beforeEach(() => {
    hoisted.evaluateAtTime.mockClear();
    hoisted.prepareComposition.mockClear();
    hoisted.copyNestedCompTextureToPreview.mockClear();
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
      resolveSourceToCompId: (source: any) => {
        if (source.type === 'composition') {
          return source.compositionId;
        }
        return null;
      },
    };

    playheadState.position = 0;
    playheadState.isUsingInternalPosition = false;

    const scheduler = renderScheduler as any;
    scheduler.registeredTargets.clear();
    scheduler.preparedCompositions.clear();
    scheduler.preparingCompositions.clear();
    scheduler.nestedCompCache.clear();
    scheduler.nestedCompCacheTime = 0;
    scheduler.activeCompLayers = null;
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

    (renderScheduler as any).registeredTargets.add('preview-comp-2');
    renderScheduler.forceRender();

    expect(hoisted.evaluateAtTime).toHaveBeenCalledWith('comp-2', 5);
    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-comp-2', []);
  });
});
