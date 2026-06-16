import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenderOutputRouterAdapter } from '../../src/engine/render/RenderOutputRouterAdapter';
import { CachedFrameRenderer } from '../../src/engine/render/dispatcher/cachedFrameRenderer';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import type { RenderTargetSnapshot } from '../../src/engine/render/contracts';
import { captureDomVisibleCanvasProof } from '../../src/services/aiTools/visiblePixelProof';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

function createVisibleCanvas(id: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.width = 16;
  canvas.height = 16;
  canvas.style.width = '16px';
  canvas.style.height = '16px';
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    right: 26,
    bottom: 26,
    width: 16,
    height: 16,
    toJSON: () => ({}),
  } as DOMRect));
  document.body.appendChild(canvas);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => canvas),
  });
  return canvas;
}

function createCanvasContext(canvas: HTMLCanvasElement): GPUCanvasContext {
  return { canvas } as unknown as GPUCanvasContext;
}

function createSnapshot(targetId: string): RenderTargetSnapshot {
  return {
    resolution: { width: 16, height: 16 },
    targets: [
      {
        id: targetId,
        name: targetId,
        source: { type: 'activeComp' },
        destinationType: 'canvas',
        enabled: true,
        showTransparencyGrid: false,
        isFullscreen: false,
      },
    ],
    activeCompositionTargetIds: [targetId],
    independentTargetIds: [],
    sliceConfigs: {},
    outputPreview: { activeTab: 'output', previewingTargetId: null },
  };
}

function createRenderer(options: {
  snapshot: RenderTargetSnapshot;
  previewContext: GPUCanvasContext | null;
  targetContexts: Map<string, GPUCanvasContext>;
}) {
  const commandEncoder = { finish: vi.fn(() => 'command-buffer') } as unknown as GPUCommandEncoder;
  const device = {
    createCommandEncoder: vi.fn(() => commandEncoder),
    queue: { submit: vi.fn() },
  } as unknown as GPUDevice;
  const scrubbingCache = {
    getGpuCachedFrame: vi.fn(() => ({
      bindGroup: { label: 'cached-bind-group' } as unknown as GPUBindGroup,
      width: 16,
      height: 16,
      format: 'rgba8unorm',
      gpuBytes: 16 * 16 * 4,
    })),
    getCachedCompositeFrame: vi.fn(() => null),
  };
  const outputPipeline = {
    renderToCanvas: vi.fn((_encoder: GPUCommandEncoder, context: GPUCanvasContext) => {
      const canvas = (context as unknown as { canvas: HTMLCanvasElement }).canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        throw new Error('2D canvas context unavailable for visible cached-frame smoke');
      }
      ctx.fillStyle = '#26d07c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }),
  };
  const outputRouter = new RenderOutputRouterAdapter({
    canvasTargets: {
      registerTargetCanvas: vi.fn(() => null),
      unregisterTargetCanvas: vi.fn(),
      getTargetContext: vi.fn((targetId: string) => options.targetContexts.get(targetId) ?? null),
    },
    captureSnapshot: vi.fn(() => options.snapshot),
    getPreviewContext: vi.fn(() => options.previewContext),
    getOutputPipeline: vi.fn(() => outputPipeline as never),
    getSlicePipeline: vi.fn(() => null),
    getResolution: vi.fn(() => options.snapshot.resolution),
    shouldSkipPreviewOutput: vi.fn(() => false),
    getExportCanvasContext: vi.fn(() => null),
    isExporting: vi.fn(() => false),
  });
  const deps = {
    getDevice: vi.fn(() => device),
    previewContext: options.previewContext,
    sampler: { label: 'sampler' } as unknown as GPUSampler,
    outputPipeline,
    cacheManager: {
      getScrubbingCache: vi.fn(() => scrubbingCache),
    },
  } as unknown as RenderDeps;
  const recordMainPreviewFrame = vi.fn();

  return {
    renderer: new CachedFrameRenderer(deps, outputRouter, recordMainPreviewFrame),
    outputPipeline,
    recordMainPreviewFrame,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalElementFromPointDescriptor) {
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
});

describe('cached frame visible presentation smoke', () => {
  it('presents a cached frame into the dock preview registered target canvas', () => {
    const canvas = createVisibleCanvas('dock-preview');
    const targetContext = createCanvasContext(canvas);
    const targetId = 'dock-preview-target';
    const { outputPipeline, renderer, recordMainPreviewFrame } = createRenderer({
      snapshot: createSnapshot(targetId),
      previewContext: null,
      targetContexts: new Map([[targetId, targetContext]]),
    });

    expect(renderer.renderCachedFrame(1.5)).toBe(true);

    const proof = captureDomVisibleCanvasProof(canvas);
    expect(outputPipeline.renderToCanvas).toHaveBeenCalledTimes(1);
    expect(recordMainPreviewFrame).toHaveBeenCalledWith('ram-gpu-cache', undefined, {
      targetTimeMs: 1500,
      displayedTimeMs: 1500,
    });
    expect(proof.attached).toBe(true);
    expect(proof.viewportIntersecting).toBe(true);
    expect(proof.centerOccluded).toBe(false);
    expect(proof.errors).toEqual([]);
    expect(proof.fingerprint?.nonBlankRatio).toBeGreaterThan(0.9);
  });

  it('presents a cached frame into the mobile legacy preview canvas', () => {
    const canvas = createVisibleCanvas('mobile-preview');
    const previewContext = createCanvasContext(canvas);
    const targetId = 'mobile-legacy-target';
    const { outputPipeline, renderer } = createRenderer({
      snapshot: createSnapshot(targetId),
      previewContext,
      targetContexts: new Map(),
    });

    expect(renderer.renderCachedFrame(2)).toBe(true);

    const proof = captureDomVisibleCanvasProof(canvas);
    expect(outputPipeline.renderToCanvas).toHaveBeenCalledTimes(1);
    expect(proof.attached).toBe(true);
    expect(proof.viewportIntersecting).toBe(true);
    expect(proof.centerOccluded).toBe(false);
    expect(proof.errors).toEqual([]);
    expect(proof.fingerprint?.nonBlankRatio).toBeGreaterThan(0.9);
  });
});
