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
  activeCompLayers: unknown[] | null;
};

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

    (renderScheduler as unknown as RenderSchedulerTestAccess).registeredTargets.add('preview-comp-2');
    renderScheduler.forceRender();

    expect(hoisted.evaluateAtTime).toHaveBeenCalledWith('comp-2', 5);
    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-comp-2', []);
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

  it('renders an active-comp viewport override with the main loop layers', () => {
    const layers = [{ id: 'active-layer', blendMode: 'screen' }] as Layer[];
    hoisted.renderTargetState.targets.set('preview-edit', {
      id: 'preview-edit',
      source: { type: 'activeComp' },
      enabled: true,
      viewportOverride: { width: 640, height: 480, cameraOverride: null },
    });
    const scheduler = renderScheduler as unknown as RenderSchedulerTestAccess;
    scheduler.registeredTargets.add('preview-edit');
    scheduler.activeCompLayers = layers;

    renderScheduler.forceRender();

    expect(hoisted.renderToPreviewCanvas).toHaveBeenCalledWith('preview-edit', layers);
    expect(hoisted.renderToPreviewCanvas.mock.calls.at(-1)?.[1]).toBe(layers);
    expect(hoisted.evaluateAtTime).not.toHaveBeenCalled();
  });
});
