import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRenderTargetStore } from '../../src/stores/renderTargetStore';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type { RenderTarget } from '../../src/types/renderTarget';

function makeTarget(overrides: Partial<RenderTarget> = {}): RenderTarget {
  return {
    id: 'target-a',
    name: 'Target A',
    source: { type: 'composition', compositionId: 'comp-a' },
    destinationType: 'canvas',
    enabled: true,
    showTransparencyGrid: false,
    canvas: null,
    context: null,
    window: null,
    isFullscreen: false,
    ...overrides,
  };
}

function makeCanvas(width = 640, height = 360): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function resetState(): void {
  useRenderTargetStore.setState({
    targets: new Map(),
    selectedTargetId: null,
  });
  timelineRuntimeCoordinator.clearResources();
}

describe('renderTargetStore runtime reporting', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  it('reports canvas-backed render targets and releases exact owners on cleanup', () => {
    const store = useRenderTargetStore.getState();
    const context = {} as GPUCanvasContext;

    store.registerTarget(makeTarget());
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['render-target'].resources).toHaveLength(0);

    store.setTargetCanvas('target-a', makeCanvas(), context);
    let stats = timelineRuntimeCoordinator.getBridgeStats().policies['render-target'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      imageBitmaps: 1,
      gpuBytes: 640 * 360 * 4,
    });
    expect(stats.resources[0]).toMatchObject({
      id: 'render-target:target-a:canvas',
      kind: 'image-canvas',
      policyId: 'render-target',
      imageKind: 'html-canvas',
      owner: {
        ownerId: 'target-a',
        ownerType: 'render-target',
        compositionId: 'comp-a',
      },
      source: {
        compositionId: 'comp-a',
      },
    });

    store.updateTargetSource('target-a', { type: 'composition', compositionId: 'comp-b' });
    stats = timelineRuntimeCoordinator.getBridgeStats().policies['render-target'];
    expect(stats.resources[0].owner.compositionId).toBe('comp-b');

    store.setTargetEnabled('target-a', false);
    stats = timelineRuntimeCoordinator.getBridgeStats().policies['render-target'];
    expect(stats.resources).toHaveLength(1);
    expect(stats.resources[0].tags).toContain('disabled');

    store.clearTargetCanvas('target-a');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['render-target'].resources).toHaveLength(0);

    store.setTargetCanvas('target-a', makeCanvas(320, 180), context);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['render-target'].resources).toHaveLength(1);

    store.unregisterTarget('target-a');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['render-target'].resources).toHaveLength(0);
  });
});
