import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { EffectPipelineCache } from '../../src/effects/EffectPipelineCache';
import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { clearEffectGpuFailures, getEffectGpuFailure, reportEffectGpuFailure } from '../../src/effects/effectGpuFailures';
import { EffectGpuFailureNotice } from '../../src/components/panels/properties/EffectGpuFailureNotice';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import { EffectGpuPipelineError } from '../../src/effects/effectGpuFailures';
import { PreviewGpuFailureNotice } from '../../src/components/preview/PreviewGpuFailureNotice';
import { clearGpuPipelineFailures, guardGpuDevice } from '../../src/engine/core/gpuPipelineGuard';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { ComputeEffectDefinition, FullscreenEffectDefinition } from '../../src/effects/types';

// Production (Android 15, Brave 155): "CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN
// While initializing [RenderPipeline "effect-voxel-relief-pipeline"]", then every frame
// "[Invalid CommandBuffer] Queue.Submit": the cache kept the invalid pipeline.
const DRIVER_FAILURE = 'CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN';

/** WebGPU error-scope semantics: an error goes to the innermost scope with its filter, else it is uncaptured. */
function deviceWithDriverFailure(failing: RegExp) {
  const scopes: Array<{ filter: GPUErrorFilter; error: GPUError | null }> = [];
  const uncaptured: string[] = [];
  const raise = (filter: GPUErrorFilter, message: string) => {
    const scope = scopes.findLast(entry => entry.filter === filter);
    if (scope) scope.error ??= { message } as GPUError; else uncaptured.push(message);
  };
  const create = (descriptor: { label?: string }) => {
    if (failing.test(descriptor.label ?? '')) raise('internal', DRIVER_FAILURE);
    return { label: descriptor.label };
  };
  const device = {
    createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})), createRenderPipeline: vi.fn(create), createComputePipeline: vi.fn(create),
    pushErrorScope: vi.fn((filter: GPUErrorFilter) => { scopes.push({ filter, error: null }); }),
    popErrorScope: vi.fn(() => Promise.resolve(scopes.pop()?.error ?? null)),
    lost: new Promise(() => undefined),
  } as unknown as GPUDevice;
  return { device, uncaptured };
}

const voxelLike = { id: 'voxel-relief', name: 'Voxel Relief', category: 'stylize', shader: '', entryPoint: 'voxelReliefFragment',
  uniformSize: 704, usesFeedback: true, params: {}, packUniforms: () => null } as unknown as FullscreenEffectDefinition;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  clearEffectGpuFailures();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GPU driver failures while building effect pipelines', () => {
  it('drops a fullscreen effect pipeline whose driver compile failed instead of using it every frame', async () => {
    const { device, uncaptured } = deviceWithDriverFailure(/voxel-relief/);
    const cache = new EffectPipelineCache(device, vi.fn());
    cache.ensure('voxel-relief', voxelLike);
    await flush();
    expect(uncaptured).toEqual([]);
    expect(cache.getPipeline('voxel-relief')).toBeUndefined();
    expect(cache.isPendingOrFailed('voxel-relief')).toBe(true);
    expect(cache.getFailure('voxel-relief')).toBe(DRIVER_FAILURE);
    // The same signature is not rebuilt every frame.
    cache.ensure('voxel-relief', voxelLike);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it('removes a compiled graph pipeline that was used in its first frame once the driver failure arrives', async () => {
    const { device } = deviceWithDriverFailure(/graph-variant/);
    const cache = new EffectPipelineCache(device, vi.fn());
    expect(cache.ensure('graph-variant', voxelLike, true)).toBe(true);
    await flush();
    expect(cache.getPipeline('graph-variant')).toBeUndefined();
    expect(cache.getFailure('graph-variant')).toBe(DRIVER_FAILURE);
  });

  it('keeps working pipelines untouched', async () => {
    const { device } = deviceWithDriverFailure(/never/);
    const cache = new EffectPipelineCache(device, vi.fn());
    cache.ensure('voxel-relief', voxelLike);
    await flush();
    expect(cache.getPipeline('voxel-relief')).toBeDefined();
    expect(cache.getFailure('voxel-relief')).toBeUndefined();
  });

  it('skips a compute effect whose pipeline the driver could not build and reports it', async () => {
    const { device } = deviceWithDriverFailure(/compute-effect-pixel-sort-pipeline/);
    const runtime = new ComputeEffectRuntime(device);
    const definition = { id: 'pixel-sort', shader: '', entryPoint: 'main', uniformSize: 0 } as unknown as ComputeEffectDefinition;
    const commandEncoder = { beginComputePass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() })) };
    const encode = () => runtime.encode({ commandEncoder: commandEncoder as unknown as GPUCommandEncoder, definition,
      inputView: {} as GPUTextureView, outputView: {} as GPUTextureView, uniformBuffer: null, width: 8, height: 8 });
    expect(encode()).toBe(true); // First frame: the failure is not known yet.
    await flush();
    expect(encode()).toBe(false);
    expect(commandEncoder.beginComputePass).toHaveBeenCalledTimes(1);
    expect(getEffectGpuFailure('pixel-sort')).toBe(DRIVER_FAILURE);
  });

  it('stops setting an image graph pass pipeline the driver could not build', async () => {
    const { device } = deviceWithDriverFailure(/./);
    const failing = device as unknown as { createRenderPipeline: ReturnType<typeof vi.fn> };
    const original = failing.createRenderPipeline.getMockImplementation()!;
    failing.createRenderPipeline.mockImplementation(() => ({ ...original({ label: 'image-graph' }), getBindGroupLayout: () => ({}) }));
    const draw = vi.fn();
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw, end() {} }) } as unknown as GPUCommandEncoder;
    Object.assign(device, { limits: { maxSampledTexturesPerShaderStage: 16 }, createTexture: vi.fn() });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
    const plan = { key: 'glow-pass', wgsl: 'fn evaluateImageGraph(inputColor: vec4f) -> vec4f { return inputColor; }', values: [],
      fusion: 'inline', capabilities: [], instructions: [], output: 0, sampleScopes: [], resourceInputs: ['atlas'] } as unknown as ImageOperatorPlan;
    const runtime = new ImageGraphPassRuntime(device);
    const encode = () => runtime.encode({ encoder, sampler: {} as GPUSampler, source: { kind: 'texture', view: {} as GPUTextureView },
      width: 8, height: 8, timelineTimeSeconds: 0, outputView: {} as GPUTextureView, instanceId: 'glow', plan,
      externalResources: new Map([['atlas', { view: {} as GPUTextureView, identity: 'a' }]]) });
    expect(encode()).toBe(true);
    await flush();
    expect(encode).toThrow(EffectGpuPipelineError);
    expect(draw).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('tells the person in the effect inspector that the effect is skipped', () => {
    render(<EffectGpuFailureNotice effectType="voxel-relief" />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => reportEffectGpuFailure('voxel-relief', DRIVER_FAILURE));
    expect(screen.getByRole('status')).toHaveTextContent(/could not build this effect, so it is skipped/);
    act(() => clearEffectGpuFailures());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names a skipped non-effect feature in the preview', async () => {
    const { device } = deviceWithDriverFailure(/flock/);
    clearGpuPipelineFailures('editor');
    render(<PreviewGpuFailureNotice />);
    expect(screen.queryByRole('status')).toBeNull();
    guardGpuDevice(device, 'editor');
    device.createRenderPipeline({ label: 'flock-render' } as GPURenderPipelineDescriptor);
    await act(flush);
    expect(screen.getByRole('status')).toHaveTextContent(/Flocking simulation could not be built on this device and is skipped/);
    act(() => clearGpuPipelineFailures('editor'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
