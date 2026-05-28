import { describe, expect, it, vi } from 'vitest';
import { Compositor } from '../../src/engine/render/Compositor';
import type { LayerRenderData } from '../../src/engine/core/types';
import { CompositorPipeline } from '../../src/engine/pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import type { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';

function makeRenderPass() {
  return {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
}

function makeLayerData(): LayerRenderData[] {
  return [{
    layer: {
      id: 'layer-1',
      maskClipId: undefined,
      effects: [
        {
          id: 'fx-brightness',
          name: 'Brightness',
          type: 'brightness',
          enabled: true,
          params: { amount: 0.4 },
        },
        {
          id: 'fx-blur',
          name: 'Blur',
          type: 'blur',
          enabled: true,
          params: { radius: 12 },
        },
      ],
    },
    isVideo: false,
    externalTexture: null,
    textureView: { label: 'source-view' },
    sourceWidth: 1920,
    sourceHeight: 1080,
  }] as unknown as LayerRenderData[];
}

describe('Compositor scrub fast path', () => {
  it('skips inline and complex effects while scrubbing', () => {
    const updateLayerUniforms = vi.fn();
    const applyEffects = vi.fn(() => ({
      finalView: { label: 'effect-view' },
      swapped: false,
    }));

    const compositor = new Compositor(
      {
        getOrCreateUniformBuffer: vi.fn(() => ({ label: 'ubo' })),
        updateLayerUniforms,
        getCompositePipeline: vi.fn(() => ({ label: 'pipeline' })),
        createCompositeBindGroup: vi.fn(() => ({ label: 'bind-group' })),
        getExternalCompositePipeline: vi.fn(),
        createExternalCompositeBindGroup: vi.fn(),
        invalidateBindGroupCache: vi.fn(),
      } as unknown as CompositorPipeline,
      { applyEffects } as unknown as EffectsPipeline,
      {
        getMaskInfo: vi.fn(() => ({ hasMask: false, view: { label: 'mask' } })),
        logMaskState: vi.fn(),
      } as unknown as MaskTextureManager
    );

    const commandEncoder = {
      beginRenderPass: vi.fn(() => makeRenderPass()),
    } as unknown as GPUCommandEncoder;

    compositor.composite(makeLayerData(), commandEncoder, {
      device: {} as unknown as GPUDevice,
      sampler: {} as unknown as GPUSampler,
      pingView: { label: 'ping' } as unknown as GPUTextureView,
      pongView: { label: 'pong' } as unknown as GPUTextureView,
      outputWidth: 1920,
      outputHeight: 1080,
      skipEffects: true,
      effectTempView: { label: 'tmp-a' } as unknown as GPUTextureView,
      effectTempView2: { label: 'tmp-b' } as unknown as GPUTextureView,
    });

    expect(updateLayerUniforms.mock.calls[0][5]).toEqual({
      brightness: 0,
      contrast: 1,
      saturation: 1,
      invert: false,
    });
    expect(applyEffects).not.toHaveBeenCalled();
  });

  it('still applies layer effects when scrub fast path is disabled', () => {
    const updateLayerUniforms = vi.fn();
    const applyEffects = vi.fn(() => ({
      finalView: { label: 'effect-view' },
      swapped: false,
    }));

    const compositor = new Compositor(
      {
        getOrCreateUniformBuffer: vi.fn(() => ({ label: 'ubo' })),
        updateLayerUniforms,
        getCompositePipeline: vi.fn(() => ({ label: 'pipeline' })),
        createCompositeBindGroup: vi.fn(() => ({ label: 'bind-group' })),
        getExternalCompositePipeline: vi.fn(),
        createExternalCompositeBindGroup: vi.fn(),
        invalidateBindGroupCache: vi.fn(),
      } as unknown as CompositorPipeline,
      { applyEffects } as unknown as EffectsPipeline,
      {
        getMaskInfo: vi.fn(() => ({ hasMask: false, view: { label: 'mask' } })),
        logMaskState: vi.fn(),
      } as unknown as MaskTextureManager
    );

    const commandEncoder = {
      beginRenderPass: vi.fn(() => makeRenderPass()),
    } as unknown as GPUCommandEncoder;

    compositor.composite(makeLayerData(), commandEncoder, {
      device: {} as unknown as GPUDevice,
      sampler: {} as unknown as GPUSampler,
      pingView: { label: 'ping' } as unknown as GPUTextureView,
      pongView: { label: 'pong' } as unknown as GPUTextureView,
      outputWidth: 1920,
      outputHeight: 1080,
      skipEffects: false,
      effectTempView: { label: 'tmp-a' } as unknown as GPUTextureView,
      effectTempView2: { label: 'tmp-b' } as unknown as GPUTextureView,
    });

    expect(updateLayerUniforms.mock.calls[0][5]).toEqual({
      brightness: 0.4,
      contrast: 1,
      saturation: 1,
      invert: false,
    });
    expect(applyEffects).toHaveBeenCalledTimes(1);
  });
});

describe('CompositorPipeline bind group cache', () => {
  it('does not reuse a static image bind group for a different source texture view in the same layer slot', () => {
    let bindGroupId = 0;
    const createBindGroup = vi.fn(() => ({ id: ++bindGroupId }));
    const pipeline = new CompositorPipeline({
      createBindGroup,
    } as unknown as GPUDevice);

    (pipeline as unknown as { compositeBindGroupLayout: GPUBindGroupLayout }).compositeBindGroupLayout = {
      label: 'composite-layout',
    } as unknown as GPUBindGroupLayout;

    const sampler = { label: 'sampler' } as unknown as GPUSampler;
    const baseView = { label: 'ping' } as unknown as GPUTextureView;
    const imageAView = { label: 'image-a' } as unknown as GPUTextureView;
    const imageBView = { label: 'image-b' } as unknown as GPUTextureView;
    const maskView = { label: 'mask' } as unknown as GPUTextureView;
    const uniformBuffer = { label: 'ubo' } as unknown as GPUBuffer;

    const firstImageBindGroup = pipeline.createCompositeBindGroup(
      sampler,
      baseView,
      imageAView,
      uniformBuffer,
      maskView,
      'activeComp_layer_0',
      true
    );
    const repeatedFirstImageBindGroup = pipeline.createCompositeBindGroup(
      sampler,
      baseView,
      imageAView,
      uniformBuffer,
      maskView,
      'activeComp_layer_0',
      true
    );
    const secondImageBindGroup = pipeline.createCompositeBindGroup(
      sampler,
      baseView,
      imageBView,
      uniformBuffer,
      maskView,
      'activeComp_layer_0',
      true
    );

    expect(createBindGroup).toHaveBeenCalledTimes(2);
    expect(repeatedFirstImageBindGroup).toBe(firstImageBindGroup);
    expect(secondImageBindGroup).not.toBe(firstImageBindGroup);
  });
});
