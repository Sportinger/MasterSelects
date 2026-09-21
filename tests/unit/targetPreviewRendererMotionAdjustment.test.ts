import { describe, expect, it, vi } from 'vitest';

import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import { TargetPreviewRenderer } from '../../src/engine/render/dispatcher/targetPreviewRenderer';
import { useRenderTargetStore } from '../../src/stores/renderTargetStore';

describe('TargetPreviewRenderer motion-adjustment parity', () => {
  it('allows feedback effects to copy their output in a viewport with local buffers', () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
    const store = useRenderTargetStore.getState();
    const stateSpy = vi.spyOn(useRenderTargetStore, 'getState').mockReturnValue({
      ...store,
      targets: new Map([['feedback-target', {
        viewportOverride: { width: 320, height: 180, cameraOverride: null },
      } as never]]),
    });
    const copyTextureToTexture = vi.fn((source: { texture: GPUTexture }) => {
      // WebGPU's validation at the feedback copy boundary (production Firefox failure).
      if (!(source.texture.usage & GPUTextureUsage.COPY_SRC)) {
        throw new Error('Feedback output texture is missing COPY_SRC');
      }
    });
    const composite = vi.fn((_layers, _encoder, options) => {
      copyTextureToTexture({ texture: options.effectTempTexture });
      copyTextureToTexture({ texture: options.effectTempTexture2 });
      return { finalView: options.pongView, usedPing: true, layerCount: 1 };
    });
    const device = {
      limits: { maxTextureDimension2D: 8192 },
      createTexture: vi.fn((descriptor: GPUTextureDescriptor) => ({
        usage: descriptor.usage,
        createView: () => ({}),
        destroy: vi.fn(),
      })),
      createCommandEncoder: () => ({ finish: vi.fn(), copyTextureToTexture }),
      queue: { submit: vi.fn() },
    };
    const deps = {
      getDevice: () => device,
      isRecovering: () => false,
      sampler: {},
      targetCanvases: new Map([['feedback-target', { canvas: {}, context: {} }]]),
      compositorPipeline: { beginFrame: vi.fn() },
      outputPipeline: {
        updateResolution: vi.fn(), createOutputBindGroup: vi.fn(), renderToCanvas: vi.fn(),
      },
      renderTargetManager: { getResolution: () => ({ width: 1920, height: 1080 }) },
      compositor: { composite },
    } as unknown as RenderDeps;
    const renderer = new TargetPreviewRenderer(deps, vi.fn(), vi.fn(), () => 0, () => false);
    try {
      renderer.renderToPreviewCanvas('feedback-target', [{
        id: 'layer', visible: true, opacity: 1, source: { type: 'model' },
      } as Layer]);
      expect(copyTextureToTexture).toHaveBeenCalledTimes(2);
      expect(device.queue.submit).toHaveBeenCalledOnce();
    } finally {
      renderer.releaseTarget('feedback-target');
      stateSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('uses the central compositor for a standard target and preserves stack order', () => {
    const pingView = { label: 'target-ping' } as unknown as GPUTextureView;
    const pongView = { label: 'target-pong' } as unknown as GPUTextureView;
    const effectView = { label: 'target-effect' } as unknown as GPUTextureView;
    const effectView2 = { label: 'target-effect-2' } as unknown as GPUTextureView;
    const effectTexture = { label: 'target-effect-texture' } as unknown as GPUTexture;
    const effectTexture2 = { label: 'target-effect-texture-2' } as unknown as GPUTexture;
    const commandEncoder = {
      finish: vi.fn(() => ({ label: 'command-buffer' })),
    } as unknown as GPUCommandEncoder;
    const composite = vi.fn(() => ({
      finalView: pongView,
      usedPing: true,
      layerCount: 3,
    }));
    const createOutputBindGroup = vi.fn(() => ({ label: 'output-bind-group' }));
    const renderToCanvas = vi.fn();
    const submit = vi.fn();
    const deps = {
      getDevice: () => ({
        limits: { maxTextureDimension2D: 8192 },
        createCommandEncoder: () => commandEncoder,
        queue: { submit },
      }),
      isRecovering: () => false,
      sampler: { label: 'sampler' },
      targetCanvases: new Map([[
        'target-a',
        { canvas: {}, context: { label: 'canvas-context' } },
      ]]),
      compositorPipeline: { beginFrame: vi.fn() },
      outputPipeline: {
        updateResolution: vi.fn(),
        createOutputBindGroup,
        renderToCanvas,
      },
      renderTargetManager: {
        getResolution: () => ({ width: 1920, height: 1080 }),
        getIndependentPingView: () => pingView,
        getIndependentPongView: () => pongView,
        getEffectTempTexture: () => effectTexture,
        getEffectTempView: () => effectView,
        getEffectTempTexture2: () => effectTexture2,
        getEffectTempView2: () => effectView2,
      },
      compositor: { composite },
      motionRenderer: null,
    } as unknown as RenderDeps;
    const recordFrame = vi.fn();
    const process3DLayers = vi.fn();
    const renderer = new TargetPreviewRenderer(
      deps,
      recordFrame,
      process3DLayers,
      () => 3.25,
      () => false,
    );
    const makeLayer = (id: string, type: 'model' | 'motion-adjustment') => ({
      id,
      visible: true,
      opacity: 1,
      source: { type },
    }) as Layer;

    renderer.renderToPreviewCanvas('target-a', [
      makeLayer('top', 'model'),
      makeLayer('adjustment', 'motion-adjustment'),
      makeLayer('bottom', 'model'),
    ]);

    expect(composite).toHaveBeenCalledOnce();
    expect(process3DLayers.mock.calls[0]?.[8]).toBe(3.25);
    expect(composite.mock.calls[0]?.[0].map((entry) => entry.layer.id)).toEqual([
      'bottom',
      'adjustment',
      'top',
    ]);
    expect(composite.mock.calls[0]?.[2]).toMatchObject({
      pingView,
      pongView,
      effectTempTexture: effectTexture,
      effectTempView: effectView,
      effectTempTexture2: effectTexture2,
      effectTempView2: effectView2,
      particleQuality: 'preview',
      motionTime: 3.25,
    });
    expect(createOutputBindGroup).toHaveBeenCalledWith(
      deps.sampler,
      pongView,
      'normal',
    );
    expect(renderToCanvas).toHaveBeenCalledOnce();
    expect(recordFrame).toHaveBeenCalledWith('target-canvas', expect.any(Array));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('pre-renders nested compositions for a standard target without a viewport override', () => {
    const pingView = { label: 'target-ping' } as unknown as GPUTextureView;
    const pongView = { label: 'target-pong' } as unknown as GPUTextureView;
    const nestedView = { label: 'nested-composition' } as unknown as GPUTextureView;
    const commandEncoder = {
      finish: vi.fn(() => ({ label: 'command-buffer' })),
    } as unknown as GPUCommandEncoder;
    const composite = vi.fn(() => ({
      finalView: pongView,
      usedPing: true,
      layerCount: 1,
    }));
    const preRender = vi.fn(() => nestedView);
    const deps = {
      getDevice: () => ({
        limits: { maxTextureDimension2D: 8192 },
        createCommandEncoder: () => commandEncoder,
        queue: { submit: vi.fn() },
      }),
      isRecovering: () => false,
      sampler: { label: 'sampler' },
      targetCanvases: new Map([[
        'target-nested',
        { canvas: {}, context: { label: 'canvas-context' } },
      ]]),
      compositorPipeline: { beginFrame: vi.fn() },
      outputPipeline: {
        updateResolution: vi.fn(),
        createOutputBindGroup: vi.fn(() => ({ label: 'output-bind-group' })),
        renderToCanvas: vi.fn(),
      },
      renderTargetManager: {
        getResolution: () => ({ width: 1920, height: 1080 }),
        getIndependentPingView: () => pingView,
        getIndependentPongView: () => pongView,
        getEffectTempTexture: () => undefined,
        getEffectTempView: () => undefined,
        getEffectTempTexture2: () => undefined,
        getEffectTempView2: () => undefined,
      },
      compositor: { composite },
      nestedCompRenderer: { preRender },
      motionRenderer: null,
    } as unknown as RenderDeps;
    const renderer = new TargetPreviewRenderer(
      deps,
      vi.fn(),
      vi.fn(),
      () => 0,
      () => false,
    );
    const childLayer = {
      id: 'child-text',
      visible: true,
      opacity: 1,
      source: { type: 'text', textCanvas: document.createElement('canvas') },
    } as unknown as Layer;
    const wrapper = {
      id: 'parent-child',
      visible: true,
      opacity: 1,
      source: {
        type: 'video',
        nestedComposition: {
          compositionId: 'child',
          layers: [childLayer],
          width: 1920,
          height: 1080,
          currentTime: 0,
        },
      },
    } as unknown as Layer;

    renderer.renderToPreviewCanvas('target-nested', [wrapper], {
      compositionId: 'parent',
      timelineTimeSeconds: 0,
    });

    expect(preRender).toHaveBeenCalledOnce();
    expect(preRender).toHaveBeenCalledWith(
      'child',
      [childLayer],
      1920,
      1080,
      commandEncoder,
      deps.sampler,
      0,
      undefined,
      undefined,
      0,
      false,
      'preview',
      undefined,
      wrapper.id,
      expect.any(Number),
      30,
    );
    expect(composite.mock.calls[0]?.[0][0]?.textureView).toBe(nestedView);
  });
});
