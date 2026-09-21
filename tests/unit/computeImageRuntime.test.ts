import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeEffectRuntime } from '../../src/effects/ComputeEffectRuntime';
import { JumpFloodRuntime } from '../../src/effects/JumpFloodRuntime';
import { imageGraphComputeOutputShader } from '../../src/effects/ImageGraphComputeOutputRuntime';
import type { ComputeEffectDefinition } from '../../src/effects/types';
import type { ComputeImagePlan } from '../../src/services/operators/computeImageGraph';

const definition = { id: 'voronoi', computeMode: 'jump-flood', shader: '', entryPoint: 'resolve', uniformSize: 16,
  workgroupSize: [8, 8], packUniforms: () => new Float32Array(4) } as unknown as ComputeEffectDefinition;
const program = { key: 'final', wgsl: '', values: [], fusion: 'inline', capabilities: [], instructions: [], output: 0,
  sampleScopes: [], resourceInputs: ['voronoi-field:jump'], fieldResources: [{ resourceId: 'voronoi-field:jump',
    producerNodeId: 'jump', outputPort: 'field', format: 'nearest-seed-rgba16float' }] } as NonNullable<ComputeImagePlan['imageProgram']>;

describe('compute image runtime', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, STORAGE_BINDING: 2 });
    vi.stubGlobal('GPUShaderStage', { COMPUTE: 1 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('alternates distinct jump targets after an external upstream stage', () => {
    let textureId = 0;
    const bindings: Array<{ label: string; entries: GPUBindGroupEntry[] }> = [];
    const device = { queue: { writeBuffer: vi.fn() }, createBuffer: () => ({ destroy: vi.fn() }),
      createTexture: () => { const id = ++textureId; return { destroy: vi.fn(), createView: () => ({ id }) }; },
      createShaderModule: () => ({}), createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
      createComputePipeline: () => ({}), createBindGroup: ({ entries }: { entries: GPUBindGroupEntry[] }) => ({ entries }) } as unknown as GPUDevice;
    const encoder = { beginComputePass: ({ label }: { label: string }) => { const record = { label, entries: [] as GPUBindGroupEntry[] };
      bindings.push(record); return { setPipeline() {}, setBindGroup(_i: number, group: { entries: GPUBindGroupEntry[] }) { record.entries = group.entries; },
        dispatchWorkgroups() {}, end() {} }; } } as unknown as GPUCommandEncoder;
    const plan = { key: 'shape', output: 'jump', passthrough: false, stages: [
      { nodeId: 'seed', kind: 'seed', params: {} }, { nodeId: 'jump', kind: 'jump-flood', input: 'seed', params: {} },
    ] } as ComputeImagePlan;
    new JumpFloodRuntime(device).encodeStages({ encoder, definition, plan, instanceId: 'fx', width: 4, height: 4, timelineTimeSeconds: 0 });
    const jumps = bindings.filter(item => item.label.startsWith('jump-'));
    expect(jumps).toHaveLength(2);
    const resource = (pass: typeof jumps[number], binding: number) => pass.entries.find(item => item.binding === binding)?.resource as { id: number };
    expect(resource(jumps[0], 3)).not.toBe(resource(jumps[0], 4));
    expect(resource(jumps[1], 3)).toBe(resource(jumps[0], 4));
    expect(resource(jumps[1], 4)).not.toBe(resource(jumps[1], 3));
  });

  it('returns passthrough without scheduling stages and maps field resources by producer ID', () => {
    const device = { lost: new Promise(() => {}), limits: {} } as GPUDevice;
    const runtime = new ComputeEffectRuntime(device), encodeStages = vi.fn(() => new Map([
      ['seed', { view: { id: 'seed' } as unknown as GPUTextureView, identity: 'seed-content' }],
      ['jump', { view: { id: 'jump' } as unknown as GPUTextureView, identity: 'jump-content' }],
    ])), encode = vi.fn(() => true), dispose = vi.fn();
    Object.assign(runtime as unknown as Record<string, unknown>, {
      jumpFloodRuntime: { encodeStages, dispose }, imageGraphComputeOutputRuntime: { encode, dispose },
    });
    const onComputeImageResources = vi.fn();
    const common = { commandEncoder: {} as GPUCommandEncoder, definition, inputView: {} as GPUTextureView,
      onComputeImageResources,
      outputView: {} as GPUTextureView, uniformBuffer: null, width: 4, height: 3, instanceId: 'clip:effect', sampler: {} as GPUSampler };
    expect(runtime.encode({ ...common, computeImagePlan: { key: 'bypass', stages: [], output: 'frame', passthrough: true } })).toBe(false);
    expect(encodeStages).not.toHaveBeenCalled();
    expect(onComputeImageResources).not.toHaveBeenCalled();
    const plan = { key: 'shape', stages: [{ nodeId: 'seed', kind: 'seed', params: {} },
      { nodeId: 'jump', kind: 'jump-flood', input: 'seed', params: {} }], output: 'output', passthrough: false, imageProgram: program } as ComputeImagePlan;
    expect(runtime.encode({ ...common, computeImagePlan: plan, timelineTimeSeconds: 2 })).toBe(true);
    expect(encodeStages).toHaveBeenCalledWith(expect.objectContaining({ plan, instanceId: 'clip:effect', timelineTimeSeconds: 2 }));
    expect(encodeStages).toHaveBeenCalledTimes(1);
    expect(onComputeImageResources).toHaveBeenCalledWith(new Map([
      ['voronoi-field:jump', expect.objectContaining({ identity: 'jump-content' })],
    ]));
    expect(onComputeImageResources.mock.invocationCallOrder[0]).toBeLessThan(encode.mock.invocationCallOrder[0]);
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ externalResources: new Map([
      ['voronoi-field:jump', expect.objectContaining({ identity: 'jump-content' })],
    ]) }));
    runtime.clear(); expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('dispatches a resource-free program directly through compute output', () => {
    const device = { lost: new Promise(() => {}), limits: {} } as GPUDevice;
    const runtime = new ComputeEffectRuntime(device), encode = vi.fn(() => true), encodeStages = vi.fn(() => new Map());
    Object.assign(runtime as unknown as Record<string, unknown>, {
      jumpFloodRuntime: { encodeStages, dispose() {} }, imageGraphComputeOutputRuntime: { encode, dispose() {} },
    });
    const plain = { ...program, resourceInputs: undefined, fieldResources: undefined };
    const plan = { key: 'plain', stages: [], output: 'output', passthrough: false, imageProgram: plain } as ComputeImagePlan;
    const singlePassDefinition = { ...definition, id: 'pixel-sort', computeMode: 'single' } as ComputeEffectDefinition;
    expect(runtime.encode({ commandEncoder: {} as GPUCommandEncoder, definition: singlePassDefinition, inputView: {} as GPUTextureView,
      outputView: {} as GPUTextureView, uniformBuffer: null, width: 2, height: 2, instanceId: 'plain',
      sampler: {} as GPUSampler, computeImagePlan: plan })).toBe(true);
    expect(encodeStages).not.toHaveBeenCalled();
    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ plan: plain, outputView: expect.anything() }));
  });

  it('still requires a jump-flood definition when specialized stages are present', () => {
    const device = { lost: new Promise(() => {}), limits: {} } as GPUDevice;
    const runtime = new ComputeEffectRuntime(device);
    const staged = { key: 'staged', stages: [{ nodeId: 'seed', kind: 'seed', params: {} }], output: 'output',
      passthrough: false, imageProgram: { ...program, resourceInputs: undefined, fieldResources: undefined } } as ComputeImagePlan;
    expect(() => runtime.encode({ commandEncoder: {} as GPUCommandEncoder,
      definition: { ...definition, computeMode: 'single' } as ComputeEffectDefinition,
      inputView: {} as GPUTextureView, outputView: {} as GPUTextureView, uniformBuffer: null,
      width: 2, height: 2, instanceId: 'staged', sampler: {} as GPUSampler, computeImagePlan: staged }))
      .toThrow('Compute image stage graphs require a jump-flood definition.');
  });

  it('generates invocation-centered storage output and rejects derivatives', () => {
    const shader = imageGraphComputeOutputShader({ ...program, resourceSampling: ['exact-pixel-load'], capabilities: ['resolution'] });
    expect(shader).toContain('@group(0) @binding(11) var imageGraphOutput: texture_storage_2d<rgba8unorm, write>');
    expect(shader).toContain('(vec2f(id.xy) + 0.5) / vec2f(dimensions)');
    expect(shader).toContain('textureStore(imageGraphOutput');
    expect(() => imageGraphComputeOutputShader({ ...program, capabilities: ['derivative'] })).toThrow(/fragment derivatives/);
    expect(() => imageGraphComputeOutputShader({ ...program,
      resourceSampling: ['unknown' as never] })).toThrow(/sampling mode is unsupported/);
  });
});
