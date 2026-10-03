import { afterEach, describe, expect, it, vi } from 'vitest';

import { EffectsPipeline } from '../../src/effects/EffectsPipeline';

describe('EffectsPipeline startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers catalog pipeline compilation until an effect is used', async () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const createShaderModule = vi.fn((_descriptor: GPUShaderModuleDescriptor) => ({}));
    const createRenderPipeline = vi.fn(() => ({}));
    const createComputePipeline = vi.fn(() => ({}));
    const device = {
      lost: new Promise<GPUDeviceLostInfo>(() => {}),
      createShaderModule,
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline,
      createComputePipeline,
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
    } as unknown as GPUDevice;

    const pipeline = new EffectsPipeline(device);
    await pipeline.createPipelines();

    // The split-compare helper owns one baseline pipeline. The effect catalog
    // itself must remain untouched until apply/prewarm requests an entry.
    // Temporal source-frame uploaders own their small upload modules (no pipelines).
    const nonTemporalModules = createShaderModule.mock.calls
      .map(([descriptor]) => descriptor.label)
      .filter((label) => !label?.startsWith('temporal-'));
    expect(nonTemporalModules).toEqual(['effect-split-compare']);
    expect(createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(createComputePipeline).not.toHaveBeenCalled();
    expect(pipeline.getPipelineCount()).toBe(0);
    expect(pipeline.isInitialized()).toBe(true);
  });

  it('does not use a fullscreen pipeline until mobile validation succeeds', async () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    let resolveValidation!: (error: GPUError | null) => void;
    const validation = new Promise<GPUError | null>((resolve) => {
      resolveValidation = resolve;
    });
    const onPipelineReady = vi.fn();
    const device = {
      lost: new Promise<GPUDeviceLostInfo>(() => {}),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn(() => validation),
      queue: { writeBuffer: vi.fn() },
    } as unknown as GPUDevice;

    const pipeline = new EffectsPipeline(device, onPipelineReady);
    await pipeline.createPipelines();
    pipeline.prewarmEffect('gaussian-blur');

    expect(pipeline.getPipelineCount()).toBe(0);
    expect(device.pushErrorScope).toHaveBeenCalledWith('validation');

    resolveValidation(null);
    await validation;
    await vi.waitFor(() => expect(pipeline.getPipelineCount()).toBe(1));
    expect(onPipelineReady).toHaveBeenCalledOnce();
  });
});
