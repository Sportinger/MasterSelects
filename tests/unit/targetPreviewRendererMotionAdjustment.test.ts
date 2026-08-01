import { describe, expect, it, vi } from 'vitest';

import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import { TargetPreviewRenderer } from '../../src/engine/render/dispatcher/targetPreviewRenderer';

describe('TargetPreviewRenderer motion-adjustment parity', () => {
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
    const renderer = new TargetPreviewRenderer(
      deps,
      recordFrame,
      vi.fn(),
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
});
