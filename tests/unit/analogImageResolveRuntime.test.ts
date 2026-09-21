import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalogSignalRuntime } from '../../src/effects/analog/signal-lab/AnalogSignalRuntime';
import { analogImageResolveShader } from '../../src/effects/analog/signal-lab/analogImageResolveShader';
import type { ComputeEffectDefinition } from '../../src/effects/types';
import type { AnalogSignalPlan } from '../../src/services/operators/analogSignalGraph';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const imageProgram: ImageOperatorPlan = {
  key: 'analog-image-test', fusion: 'inline', capabilities: ['uv', 'resolution', 'time'], values: [.25], instructions: [], output: 0,
  sampleScopes: [], resourceInputs: ['decoded', 'source'], resourceSampling: ['manual-bilinear-clamp', 'manual-bilinear-clamp'],
  wgsl: `struct ImageOperatorParameters { values: array<vec4f, 16>, };
fn evaluateImageGraph(pixel: vec4f, inputUv: vec2f, inputResolution: vec2f, timelineTimeSeconds: f32,
  imageParameters: ImageOperatorParameters) -> vec4f {
  return mix(sampleImageGraphResource0(inputUv), sampleImageGraphResource1(inputUv), imageParameters.values[0].x)
    + vec4f((inputResolution.x + timelineTimeSeconds) * 0.0);
}`,
};

function harness() {
  const shaders: string[] = [], buffers: Array<{ size: number; destroy: ReturnType<typeof vi.fn> }> = [], labels: string[] = [];
  const pass = (label: string) => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn(() => labels.push(label)) });
  const device = { queue: { writeBuffer: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) }, createShaderModule: vi.fn(({ code }: { code: string }) => { shaders.push(code); return {}; }),
    createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})), createComputePipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(({ entries }: { entries: unknown[] }) => ({ entries })),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createBuffer: vi.fn(({ size }: { size: number }) => { const buffer = { size, destroy: vi.fn() }; buffers.push(buffer); return buffer; }) };
  const encoder = { beginComputePass: vi.fn(({ label }: { label: string }) => pass(label)) };
  return { device, encoder, shaders, buffers, labels };
}

describe('Analog image resolve runtime', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 4 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, UNIFORM: 64, COPY_DST: 8 });
  });

  it('maps named inputs by id and emits the canonical runtime ABI in one compute shader', () => {
    const generated = analogImageResolveShader(imageProgram);
    expect(generated.uniformSize).toBe(272);
    expect(generated.shader).toContain('fn sampleImageGraphResource0(uv: vec2f)');
    expect(generated.shader).toMatch(/sampleImageGraphResource0[\s\S]*textureDimensions\(analogDecodedInput\)/);
    expect(generated.shader).toMatch(/sampleImageGraphResource1[\s\S]*textureDimensions\(analogOriginalInput\)/);
    expect(generated.shader).toContain('evaluateImageGraph(original, uv, vec2f(dimensions), imageGraphRuntime.timelineTimeSeconds, imageGraphRuntime.imageParameters)');
    expect(() => analogImageResolveShader({ ...imageProgram, passes: [{ id: 'p', program: imageProgram, inputResources: [] }] }))
      .toThrow(/multi-pass/);
    expect(() => analogImageResolveShader({ ...imageProgram, resourceInputs: ['unknown'] })).toThrow(/unknown named image input/);
    expect(() => analogImageResolveShader({ ...imageProgram, capabilities: ['derivative'] })).toThrow(/fragment derivatives/);
    const constantGenerated = analogImageResolveShader({ ...imageProgram, key: 'constant', capabilities: [], values: [],
      resourceInputs: undefined, resourceSampling: undefined,
      wgsl: 'fn evaluateImageGraph(pixel: vec4f) -> vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }' });
    expect(constantGenerated.uniformSize).toBe(0);
    expect(constantGenerated.shader).toContain('evaluateImageGraph(original)');
  });

  it('caches the image pipeline, reuses sized uniforms, and releases runtime-owned resources', () => {
    const gpu = harness(), runtime = new AnalogSignalRuntime(gpu.device as never);
    const definition = { pipelineKind: 'compute', computeMode: 'analog-signal', uniformSize: 16, shader: 'legacy', entryPoint: 'legacyResolve',
      packUniforms: () => new Float32Array(4) } as unknown as ComputeEffectDefinition;
    const plan = { key: 'plan', output: 'resolve', passthrough: false, stages: [
      { nodeId: 'encode', kind: 'encode', input: 'frame', params: {} },
      { nodeId: 'resolve', kind: 'resolve', source: 'frame', input: 'encode', params: {}, imageProgram },
    ] } as unknown as AnalogSignalPlan;
    const options = { commandEncoder: gpu.encoder as never, definition, plan, instanceId: 'effect', inputView: {} as never,
      outputView: {} as never, width: 320, height: 180, timelineTimeSeconds: 3 };
    runtime.encode(options); runtime.encode({ ...options, timelineTimeSeconds: 4 });
    expect(gpu.labels).toEqual(['analog-encode-encode', 'analog-resolve-image-resolve', 'analog-encode-encode', 'analog-resolve-image-resolve']);
    expect(gpu.shaders.filter(shader => shader.includes('analogImageResolveCompute'))).toHaveLength(1);
    expect(gpu.buffers.filter(buffer => buffer.size === 272)).toHaveLength(1);
    expect(gpu.device.queue.writeBuffer).toHaveBeenCalledTimes(4);
    runtime.clear(); expect(gpu.buffers.every(buffer => buffer.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('offers demand-only specialized plan encoding even when the main plan is passthrough', () => {
    const gpu = harness(), callback = vi.fn(), runtime = new AnalogSignalRuntime(gpu.device as never);
    const definition = { pipelineKind: 'compute', computeMode: 'analog-signal', uniformSize: 16, shader: 'legacy', entryPoint: 'legacyResolve',
      packUniforms: () => new Float32Array(4) } as unknown as ComputeEffectDefinition;
    expect(runtime.encode({ commandEncoder: gpu.encoder as never, definition, plan: { key: 'direct', output: 'frame', passthrough: true, stages: [] },
      instanceId: 'direct', inputView: {} as never, outputView: {} as never, width: 320, height: 180, timelineTimeSeconds: 0,
      onImagePreviewInputs: callback })).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1); expect(callback.mock.calls[0][0]).toBeUndefined();
    expect(callback.mock.calls[0][1]).toMatchObject({ width: 320, height: 180, sourceView: expect.anything(), encodePlan: expect.any(Function) });
    expect(gpu.device.createComputePipeline).not.toHaveBeenCalled();
  });

  it('bounds preview-only instances without destroying resources before a delayed encoder submission', () => {
    const gpu = harness(), runtime = new AnalogSignalRuntime(gpu.device as never);
    const internals = runtime as unknown as { resources: Map<string, { planKey: string; textures: Map<string, { destroy: ReturnType<typeof vi.fn> }>;
      lineStates: Map<string, { destroy: ReturnType<typeof vi.fn> }>; uniformBuffers: Map<string, { destroy: ReturnType<typeof vi.fn> }> }>;
      previewInstances: Map<string, true>; touchPreviewInstance(id: string): void };
    const retiredBuffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    for (let index = 0; index < 9; index++) {
      const id = `effect:preview:${index}`; internals.touchPreviewInstance(id);
      const buffer = { destroy: vi.fn() }; retiredBuffers.push(buffer);
      internals.resources.set(id, { planKey: id, textures: new Map(), lineStates: new Map(), uniformBuffers: new Map([['u', buffer]]) });
    }
    expect(internals.previewInstances.size).toBe(8); expect(internals.resources.has('effect:preview:0')).toBe(false);
    internals.touchPreviewInstance('effect:preview:1');
    internals.touchPreviewInstance('effect:preview:9');
    expect(internals.previewInstances.size).toBe(8); expect(internals.resources.has('effect:preview:1')).toBe(true);
    expect(gpu.device.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
    expect(retiredBuffers[0].destroy).not.toHaveBeenCalled(); expect(retiredBuffers[2].destroy).not.toHaveBeenCalled();
  });
});
