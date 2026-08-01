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

function makeSourceLayerData(
  id: string,
  textureLabel: string,
): LayerRenderData {
  return {
    layer: {
      id,
      name: id,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'image' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    },
    isVideo: false,
    externalTexture: null,
    textureView: { label: textureLabel } as unknown as GPUTextureView,
    sourceWidth: 1920,
    sourceHeight: 1080,
  };
}

function makeAdjustmentLayerData(
  effects: LayerRenderData['layer']['effects'],
): LayerRenderData {
  return {
    layer: {
      id: 'adjustment',
      name: 'Adjustment',
      visible: true,
      opacity: 0.6,
      blendMode: 'screen',
      source: { type: 'motion-adjustment' },
      effects,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      maskClipId: 'adjustment-mask',
    },
    isVideo: false,
    externalTexture: null,
    textureView: null,
    sourceWidth: 0,
    sourceHeight: 0,
  };
}

function makeCompositorHarness() {
  const updateLayerUniforms = vi.fn();
  const createCompositeBindGroup = vi.fn(() => ({ label: 'bind-group' }));
  const applyEffects = vi.fn((
    _commandEncoder: GPUCommandEncoder,
    _effects: unknown[],
    _sampler: GPUSampler,
    _inputView: GPUTextureView,
    outputView: GPUTextureView,
  ) => ({ finalView: outputView, swapped: true }));
  const getMaskInfo = vi.fn((id: string) => ({
    hasMask: id === 'adjustment-mask',
    view: { label: `mask-${id}` },
  }));
  const compositor = new Compositor(
    {
      getOrCreateUniformBuffer: vi.fn((id: string) => ({ label: `ubo-${id}` })),
      updateLayerUniforms,
      getCompositePipeline: vi.fn(() => ({ label: 'pipeline' })),
      createCompositeBindGroup,
      getExternalCompositePipeline: vi.fn(),
      createExternalCompositeBindGroup: vi.fn(),
      invalidateBindGroupCache: vi.fn(),
    } as unknown as CompositorPipeline,
    { applyEffects } as unknown as EffectsPipeline,
    {
      getMaskInfo,
      logMaskState: vi.fn(),
    } as unknown as MaskTextureManager,
  );
  const commandEncoder = {
    beginRenderPass: vi.fn(() => makeRenderPass()),
  } as unknown as GPUCommandEncoder;
  const state = {
    device: {} as unknown as GPUDevice,
    sampler: { label: 'sampler' } as unknown as GPUSampler,
    pingView: { label: 'ping' } as unknown as GPUTextureView,
    pongView: { label: 'pong' } as unknown as GPUTextureView,
    outputWidth: 1920,
    outputHeight: 1080,
    effectTempView: { label: 'tmp-a' } as unknown as GPUTextureView,
    effectTempView2: { label: 'tmp-b' } as unknown as GPUTextureView,
  };

  return {
    compositor,
    commandEncoder,
    state,
    updateLayerUniforms,
    createCompositeBindGroup,
    applyEffects,
    getMaskInfo,
  };
}

describe('Compositor motion adjustment layers', () => {
  it('processes the accumulated lower frame in layer order and mixes before the upper layer', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.4 },
    }]);

    const result = harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
      makeSourceLayerData('top', 'top-source'),
    ], harness.commandEncoder, harness.state);

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(3);
    expect(harness.createCompositeBindGroup.mock.calls.map((call) => ({
      base: (call[1] as { label: string }).label,
      source: (call[2] as { label: string }).label,
    }))).toEqual([
      { base: 'ping', source: 'bottom-source' },
      { base: 'pong', source: 'pong' },
      { base: 'ping', source: 'top-source' },
    ]);
    expect(result.finalView).toBe(harness.state.pongView);
  });

  it('passes inline effects and full-frame mask/mix controls to the adjustment composite', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.4 },
    }]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, harness.state);

    const uniformCall = harness.updateLayerUniforms.mock.calls[1];
    expect(uniformCall[0]).toBe(adjustment.layer);
    expect(uniformCall[1]).toBe(16 / 9);
    expect(uniformCall[2]).toBe(16 / 9);
    expect(uniformCall[3]).toBe(true);
    expect(uniformCall[5]).toEqual({
      brightness: 0.4,
      contrast: 1,
      saturation: 1,
      invert: false,
    });
    expect(uniformCall[6]).toBe(1);
    expect(harness.getMaskInfo).toHaveBeenCalledWith('adjustment-mask');
    expect(harness.applyEffects).not.toHaveBeenCalled();
  });

  it('renders gaussian blur from the accumulated frame into a temp view before mixing', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-blur',
      name: 'Gaussian Blur',
      type: 'gaussian-blur',
      enabled: true,
      params: { radius: 12, samples: 5 },
    }]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, harness.state);

    expect(harness.applyEffects).toHaveBeenCalledTimes(1);
    const effectCall = harness.applyEffects.mock.calls[0];
    expect((effectCall[3] as { label: string }).label).toBe('pong');
    expect((effectCall[4] as { label: string }).label).toBe('tmp-a');
    const adjustmentBindGroupCall = harness.createCompositeBindGroup.mock.calls[1];
    expect((adjustmentBindGroupCall[1] as { label: string }).label).toBe('pong');
    expect((adjustmentBindGroupCall[2] as { label: string }).label).toBe('tmp-a');
  });

  it('is a no-op when effects are skipped and preserves the accumulator for the next layer', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.4 },
    }]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
      makeSourceLayerData('top', 'top-source'),
    ], harness.commandEncoder, { ...harness.state, skipEffects: true });

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(2);
    expect(harness.createCompositeBindGroup.mock.calls.map((call) => ({
      base: (call[1] as { label: string }).label,
      source: (call[2] as { label: string }).label,
    }))).toEqual([
      { base: 'ping', source: 'bottom-source' },
      { base: 'pong', source: 'top-source' },
    ]);
    expect(harness.updateLayerUniforms).toHaveBeenCalledTimes(2);
    expect(harness.applyEffects).not.toHaveBeenCalled();
  });

  it('still applies the frozen adjustment mix when no effect is enabled', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, harness.state);

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(2);
    const adjustmentBindGroupCall = harness.createCompositeBindGroup.mock.calls[1];
    expect((adjustmentBindGroupCall[1] as { label: string }).label).toBe('pong');
    expect((adjustmentBindGroupCall[2] as { label: string }).label).toBe('pong');
    expect(harness.updateLayerUniforms).toHaveBeenCalledTimes(2);
  });

  it('isolates uniform and bind-group cache ids by render occurrence', () => {
    const harness = makeCompositorHarness();
    const staticLayer = makeSourceLayerData('shared-layer', 'shared-source');
    staticLayer.layer.source!.imageElement = {} as HTMLImageElement;

    harness.compositor.composite([
      staticLayer,
    ], harness.commandEncoder, {
      ...harness.state,
      resourceNamespace: 'nested-occurrence-a',
    });

    const pipeline = (harness.compositor as unknown as {
      compositorPipeline: CompositorPipeline;
    }).compositorPipeline;
    expect(pipeline.getOrCreateUniformBuffer).toHaveBeenCalledWith(
      JSON.stringify(['nested-occurrence-a', 'shared-layer']),
    );
    expect(harness.createCompositeBindGroup.mock.calls[0]?.[5]).toBe(
      JSON.stringify(['nested-occurrence-a', 'shared-layer']),
    );
  });

  it('fails closed instead of partially applying a stack with an unsupported enabled effect', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([
      {
        id: 'fx-brightness',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: { amount: 0.4 },
      },
      {
        id: 'fx-glow',
        name: 'Glow',
        type: 'glow',
        enabled: true,
        params: { radius: 12 },
      },
    ]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, harness.state);

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(1);
    expect(harness.updateLayerUniforms).toHaveBeenCalledTimes(1);
    expect(harness.applyEffects).not.toHaveBeenCalled();
  });

  it('keeps the frozen preflight strict for disabled unsupported effects', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-disabled-glow',
      name: 'Disabled Glow',
      type: 'glow',
      enabled: false,
      params: { radius: 12 },
    }]);

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, harness.state);

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(1);
    expect(harness.updateLayerUniforms).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported enabled effect during export', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-glow',
      name: 'Glow',
      type: 'glow',
      enabled: true,
      params: { radius: 12 },
    }]);

    expect(() => harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, {
      ...harness.state,
      particleQuality: 'export',
    })).toThrow('unsupported effect glow');
  });

  it('fails closed when a complex adjustment effect has no temporary render targets', () => {
    const harness = makeCompositorHarness();
    const adjustment = makeAdjustmentLayerData([{
      id: 'fx-blur',
      name: 'Gaussian Blur',
      type: 'gaussian-blur',
      enabled: true,
      params: { radius: 12, samples: 5 },
    }]);
    const stateWithoutEffectTargets = {
      ...harness.state,
      effectTempView: undefined,
      effectTempView2: undefined,
    };

    harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, stateWithoutEffectTargets);

    expect(harness.createCompositeBindGroup).toHaveBeenCalledTimes(1);
    expect(harness.applyEffects).not.toHaveBeenCalled();
    expect(() => harness.compositor.composite([
      makeSourceLayerData('bottom', 'bottom-source'),
      adjustment,
    ], harness.commandEncoder, {
      ...stateWithoutEffectTargets,
      particleQuality: 'export',
    })).toThrow('requires effect render targets');
  });
});

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
  it('initializes every distinct uniform buffer even when the layer values are identical', () => {
    const writeBuffer = vi.fn();
    const pipeline = new CompositorPipeline({
      queue: { writeBuffer },
    } as unknown as GPUDevice);
    const layer = makeSourceLayerData('shared-nested-layer', 'source').layer;
    const firstOccurrenceBuffer = { label: 'outer-a' } as unknown as GPUBuffer;
    const secondOccurrenceBuffer = { label: 'outer-b' } as unknown as GPUBuffer;

    pipeline.updateLayerUniforms(layer, 16 / 9, 16 / 9, false, firstOccurrenceBuffer);
    pipeline.updateLayerUniforms(layer, 16 / 9, 16 / 9, false, secondOccurrenceBuffer);

    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls.map((call) => call[0])).toEqual([
      firstOccurrenceBuffer,
      secondOccurrenceBuffer,
    ]);
  });

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
