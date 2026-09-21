import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGraphPassRuntime } from '../../src/effects/ImageGraphPassRuntime';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const base = (key: string, resourceInputs?: readonly string[]): ImageOperatorPlan => ({ key, wgsl: 'fn evaluateImageGraph(inputColor: vec4f) -> vec4f { return inputColor; }', values: [],
  fusion: 'inline', capabilities: [], instructions: [], output: 0, sampleScopes: [], ...(resourceInputs ? { resourceInputs } : {}) });

describe('ImageGraphPassRuntime', () => {
  beforeEach(() => { vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 }); vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 }); });
  afterEach(() => vi.unstubAllGlobals());

  it('encodes producer order, reuses allocations, resizes, and disposes owned textures', () => {
    const draws: unknown[] = [], destroyed: Array<ReturnType<typeof vi.fn>> = [];
    const createTexture = vi.fn(() => { const destroy = vi.fn(); destroyed.push(destroy); const view = {}; return { destroy, createView: () => view }; });
    const pipeline = { getBindGroupLayout: () => ({}) };
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() }, createTexture,
      createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => pipeline), createBindGroup: vi.fn(() => ({})), createBuffer: vi.fn() } as unknown as GPUDevice;
    const encoder = { beginRenderPass: vi.fn(({ colorAttachments }) => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: () => draws.push(colorAttachments[0].view), end: vi.fn() })) } as unknown as GPUCommandEncoder;
    const producer = base('producer'), final = base('final', ['blur']);
    const plan = { ...final, passes: [{ id: 'blur-pass', program: producer, inputResources: [], outputResource: 'blur' },
      { id: 'final-pass', program: final, inputResources: ['blur'] }], resources: [{ id: 'blur', producerPassId: 'blur-pass', format: 'rgba16float' as const }] };
    const runtime = new ImageGraphPassRuntime(device), common = { encoder, sampler: {} as GPUSampler, source: { kind: 'texture' as const, view: {} as GPUTextureView },
      timelineTimeSeconds: 0, plan, outputView: {} as GPUTextureView, instanceId: 'effect-a' };
    expect(runtime.encode({ ...common, width: 320, height: 180 })).toBe(true);
    expect(draws).toHaveLength(2); expect(createTexture).toHaveBeenCalledTimes(1);
    runtime.encode({ ...common, width: 320, height: 180 }); expect(createTexture).toHaveBeenCalledTimes(1);
    runtime.encode({ ...common, width: 640, height: 360 }); expect(createTexture).toHaveBeenCalledTimes(2); expect(destroyed[0]).not.toHaveBeenCalled();
    runtime.dispose(); expect(destroyed[0]).not.toHaveBeenCalled(); expect(destroyed[1]).toHaveBeenCalledOnce();
  });

  it('rejects a consumer before its declared resource producer', () => {
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: {}, createTexture: () => ({ destroy() {}, createView: () => ({}) }) } as unknown as GPUDevice;
    const program = base('consumer', ['missing']), plan = { ...program, passes: [{ id: 'consumer', program, inputResources: ['missing'] }],
      resources: [{ id: 'missing', producerPassId: 'later', format: 'rgba16float' as const }] };
    expect(() => new ImageGraphPassRuntime(device).encode({ encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 1, height: 1, timelineTimeSeconds: 0, plan,
      outputView: {} as GPUTextureView, instanceId: 'bad' })).toThrow(/unavailable resource/);
  });

  it('keeps differing uniform payloads isolated across encodes recorded before submission', () => {
    const buffers: object[] = [], bound: GPUBindGroupEntry[][] = [];
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() },
      createTexture: () => ({ destroy() {}, createView: () => ({}) }), createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBuffer: vi.fn(() => { const value = { destroy: vi.fn() }; buffers.push(value); return value; }),
      createBindGroup: vi.fn(({ entries }) => { bound.push(entries); return {}; }) } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) } as unknown as GPUCommandEncoder;
    const makePlan = (value: number) => { const program = { ...base('dynamic'), values: [value] }; return { ...program, passes: [{ id: 'final', program, inputResources: [] }], resources: [] }; };
    const runtime = new ImageGraphPassRuntime(device), common = { encoder, sampler: {} as GPUSampler, source: { kind: 'texture' as const, view: {} as GPUTextureView },
      width: 16, height: 16, timelineTimeSeconds: 0, outputView: {} as GPUTextureView, instanceId: 'animated' };
    runtime.encode({ ...common, plan: makePlan(1) }); runtime.encode({ ...common, plan: makePlan(2) });
    expect(buffers).toHaveLength(2);
    expect(bound[0].find(entry => entry.binding === 2)?.resource).not.toBe(bound[1].find(entry => entry.binding === 2)?.resource);
  });

  it('deduplicates a common producer only inside one explicit batch', () => {
    const draw = vi.fn(), texture = () => ({ destroy: vi.fn(), createView: () => ({}) });
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() }, createTexture: vi.fn(texture),
      createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup: () => ({}), createBuffer: vi.fn() } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw, end() {} }) } as unknown as GPUCommandEncoder;
    const producer = base('shared-producer'), target = (id: string) => { const final = base(`final-${id}`, ['shared']); return { ...final,
      passes: [{ id: 'producer', program: producer, inputResources: [], outputResource: 'shared' }, { id: `final-${id}`, program: final, inputResources: ['shared'] }],
      resources: [{ id: 'shared', producerPassId: 'producer', format: 'rgba16float' as const }] }; };
    const runtime = new ImageGraphPassRuntime(device), batch = runtime.createBatch(), common = { encoder, sampler: {} as GPUSampler,
      source: { kind: 'texture' as const, view: {} as GPUTextureView }, width: 32, height: 32, timelineTimeSeconds: 0, outputView: {} as GPUTextureView };
    runtime.encode({ ...common, plan: target('a'), instanceId: 'preview-a', batch });
    runtime.encode({ ...common, plan: target('b'), instanceId: 'preview-b', batch });
    expect(draw).toHaveBeenCalledTimes(3);
    runtime.encode({ ...common, plan: target('a'), instanceId: 'preview-a', batch: runtime.createBatch() });
    expect(draw).toHaveBeenCalledTimes(5);
  });

  it('bounds instance allocations and structural pipelines with LRU eviction', () => {
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() },
      createTexture: () => ({ destroy() {}, createView: () => ({}) }), createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup: () => ({}) } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) } as unknown as GPUCommandEncoder;
    const runtime = new ImageGraphPassRuntime(device), common = { encoder, sampler: {} as GPUSampler,
      source: { kind: 'texture' as const, view: {} as GPUTextureView }, width: 8, height: 8, timelineTimeSeconds: 0, outputView: {} as GPUTextureView };
    for (let index = 0; index < 70; index++) { const program = base(`program-${index}`);
      runtime.encode({ ...common, instanceId: `effect-${index}`, plan: { ...program, passes: [{ id: 'final', program, inputResources: [] }], resources: [] } }); }
    const caches = runtime as unknown as { allocations: Map<string, unknown>; activeAllocationKeys: Map<string, string>; pipelines: Map<string, unknown> };
    expect(caches.allocations.size).toBeLessThanOrEqual(32); expect(caches.activeAllocationKeys.size).toBeLessThanOrEqual(32);
    expect(caches.pipelines.size).toBeLessThanOrEqual(64);
  });

  it('exposes an exact materialized producer without encoding the final copy and rejects another encoder', () => {
    const draw = vi.fn(), device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() },
      createTexture: () => ({ destroy() {}, createView: () => ({}) }), createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup: () => ({}) } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw, end() {} }) } as unknown as GPUCommandEncoder;
    const producer = base('materialize'), final = base('copy', ['materialized']);
    const plan = { ...final, previewResourceId: 'materialized', passes: [{ id: 'producer', program: producer, inputResources: [], outputResource: 'materialized' },
      { id: 'final', program: final, inputResources: ['materialized'] }], resources: [{ id: 'materialized', producerPassId: 'producer', format: 'rgba16float' as const }] };
    const runtime = new ImageGraphPassRuntime(device), batch = runtime.createBatch(), options = { encoder, sampler: {} as GPUSampler,
      source: { kind: 'texture' as const, view: {} as GPUTextureView }, width: 16, height: 16, timelineTimeSeconds: 0, plan,
      instanceId: 'preview', batch, stopAtResourceId: 'materialized' };
    runtime.encode(options); expect(draw).toHaveBeenCalledOnce(); expect(runtime.getBatchResourceView(batch, 'materialized')).toBeDefined();
    expect(() => runtime.encode({ ...options, encoder: {} as GPUCommandEncoder })).toThrow(/cannot mix source or frame context/);
  });

  it('does not reuse an overwritten resource view for payload A-B-A in one batch', () => {
    const draw = vi.fn(), device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}), queue: { writeBuffer: vi.fn() },
      createTexture: () => ({ destroy() {}, createView: () => ({}) }), createShaderModule: () => ({}), createBuffer: () => ({ destroy() {} }),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup: () => ({}) } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw, end() {} }) } as unknown as GPUCommandEncoder;
    const runtime = new ImageGraphPassRuntime(device), batch = runtime.createBatch(), makePlan = (value: number) => { const producer = { ...base('same-key'), values: [value] };
      return { ...producer, previewResourceId: 'r', passes: [{ id: 'producer', program: producer, inputResources: [], outputResource: 'r' }],
        resources: [{ id: 'r', producerPassId: 'producer', format: 'rgba16float' as const }] }; };
    const common = { encoder, sampler: {} as GPUSampler, source: { kind: 'texture' as const, view: {} as GPUTextureView }, width: 8, height: 8,
      timelineTimeSeconds: 0, instanceId: 'preview', batch, stopAtResourceId: 'r' };
    runtime.encode({ ...common, plan: makePlan(1) }); const firstA = runtime.getBatchResourceView(batch, 'r');
    runtime.encode({ ...common, plan: makePlan(2) }); const viewB = runtime.getBatchResourceView(batch, 'r');
    runtime.encode({ ...common, plan: makePlan(1) }); const secondA = runtime.getBatchResourceView(batch, 'r');
    expect(draw).toHaveBeenCalledTimes(2); expect(viewB).not.toBe(firstA); expect(secondA).toBe(firstA);
  });
});
