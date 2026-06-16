import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CachedFrameRenderer } from '../../src/engine/render/dispatcher/cachedFrameRenderer';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import type { RenderOutputRouter, RenderTargetSnapshot } from '../../src/engine/render/contracts';

const snapshot: RenderTargetSnapshot = {
  resolution: { width: 1280, height: 720 },
  targets: [
    {
      id: 'preview-target',
      name: 'Preview',
      source: { type: 'activeComp' },
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid: false,
      isFullscreen: false,
    },
  ],
  activeCompositionTargetIds: ['preview-target'],
  independentTargetIds: [],
  sliceConfigs: {},
  outputPreview: { activeTab: 'output', previewingTargetId: null },
};

function createHarness(options: {
  previewContext?: GPUCanvasContext | null;
  targetContext?: GPUCanvasContext | null;
} = {}) {
  const commandEncoder = {
    finish: vi.fn(() => 'finished-command-buffer'),
  } as unknown as GPUCommandEncoder;
  const device = {
    createCommandEncoder: vi.fn(() => commandEncoder),
    queue: {
      submit: vi.fn(),
    },
  } as unknown as GPUDevice;
  const bindGroup = { label: 'gpu-cache-bind-group' } as unknown as GPUBindGroup;
  const scrubbingCache = {
    getGpuCachedFrame: vi.fn(() => ({
      bindGroup,
      width: 1280,
      height: 720,
      format: 'rgba8unorm',
      gpuBytes: 1280 * 720 * 4,
    })),
    getCachedCompositeFrame: vi.fn(() => null),
  };
  const deps = {
    getDevice: vi.fn(() => device),
    previewContext: options.previewContext ?? null,
    sampler: { label: 'sampler' } as unknown as GPUSampler,
    outputPipeline: { label: 'output-pipeline' },
    cacheManager: {
      getScrubbingCache: vi.fn(() => scrubbingCache),
    },
  } as unknown as RenderDeps;
  const outputRouter: RenderOutputRouter = {
    captureSnapshot: vi.fn(() => snapshot),
    registerCanvasTarget: vi.fn(() => null),
    unregisterTarget: vi.fn(),
    routeCompositeFrame: vi.fn(),
    routeEmptyFrame: vi.fn(),
    routeCachedFrame: vi.fn(),
    getTargetContext: vi.fn(() => options.targetContext ?? null),
  };
  const recordMainPreviewFrame = vi.fn();
  const renderer = new CachedFrameRenderer(deps, outputRouter, recordMainPreviewFrame);

  return {
    bindGroup,
    commandEncoder,
    deps,
    device,
    outputRouter,
    recordMainPreviewFrame,
    renderer,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CachedFrameRenderer', () => {
  it('routes GPU cached frames to registered target canvases without a legacy preview context', () => {
    const targetContext = { label: 'target-context' } as unknown as GPUCanvasContext;
    const {
      bindGroup,
      commandEncoder,
      device,
      outputRouter,
      recordMainPreviewFrame,
      renderer,
    } = createHarness({ previewContext: null, targetContext });

    expect(renderer.renderCachedFrame(2.5)).toBe(true);

    expect(outputRouter.getTargetContext).toHaveBeenCalledWith('preview-target');
    expect(outputRouter.routeCachedFrame).toHaveBeenCalledWith({
      commandEncoder,
      bindGroup,
      time: 2.5,
      snapshot,
      targetIds: ['preview-target'],
    });
    expect(recordMainPreviewFrame).toHaveBeenCalledWith('ram-gpu-cache', undefined, {
      targetTimeMs: 2500,
      displayedTimeMs: 2500,
    });
    expect(device.queue.submit).toHaveBeenCalledWith(['finished-command-buffer']);
  });

  it('does not report a cached-frame hit when no preview or target destination exists', () => {
    const {
      device,
      outputRouter,
      recordMainPreviewFrame,
      renderer,
    } = createHarness({ previewContext: null, targetContext: null });

    expect(renderer.renderCachedFrame(2.5)).toBe(false);

    expect(outputRouter.routeCachedFrame).not.toHaveBeenCalled();
    expect(recordMainPreviewFrame).not.toHaveBeenCalled();
    expect(device.createCommandEncoder).not.toHaveBeenCalled();
    expect(device.queue.submit).not.toHaveBeenCalled();
  });

  it('keeps routing GPU cached frames when only the legacy preview context exists', () => {
    const previewContext = { label: 'preview-context' } as unknown as GPUCanvasContext;
    const {
      outputRouter,
      renderer,
    } = createHarness({ previewContext, targetContext: null });

    expect(renderer.renderCachedFrame(1)).toBe(true);

    expect(outputRouter.routeCachedFrame).toHaveBeenCalledWith(expect.objectContaining({
      time: 1,
      snapshot,
      targetIds: ['preview-target'],
    }));
  });
});
