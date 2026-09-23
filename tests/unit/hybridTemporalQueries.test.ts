import { afterEach, expect, it, vi } from 'vitest';
import { HybridTemporalRuntime } from '../../src/effects/time/HybridTemporalRuntime';
import { collectTemporalPreparations } from '../../src/effects/time/temporalResourcePreparation';
import { hybridTemporalMemory } from '../../src/effects/time/hybridTemporalWindow';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
const mock = vi.hoisted(() => ({ upload: vi.fn(), request: vi.fn(), release: vi.fn(), encode: vi.fn(), accumulate: vi.fn(), needed: vi.fn() }));
vi.mock('../../src/services/mediaRuntime/sourceFrames/SourceFrameService', () => ({ sourceFrameService: { acquire: () => ({
  ready: Promise.resolve({ frames: Array.from({ length: 101 }, (_, i) => ({ time: i / 10, duration: .1 })) }), release: mock.release,
  request: async ({ times, onFrame }: any) => { mock.request(times); times.forEach((time: number) => onFrame({ time })); },
}) } }));
vi.mock('../../src/engine/texture/TemporalFrameUploader', () => ({ TemporalFrameUploader: class { upload = mock.upload; destroy() {} } }));
vi.mock('../../src/effects/time/StabilizedCurrentFrame', () => ({ StabilizedCurrentFrame: class { encode() { return {}; } destroy() {} } }));
vi.mock('../../src/effects/ImageGraphPassRuntime', () => ({ ImageGraphPassRuntime: class { encode = mock.encode; dispose() {} } }));
vi.mock('../../src/services/operators/imageEffectRuntimePlan', () => ({ prepareImageEffect: ({ operatorGraph }: any) => ({ plan: { graph: operatorGraph } }) }));
vi.mock('../../src/effects/time/HybridTemporalGpu', () => ({ HybridTemporalGpu: class { accumulate = mock.accumulate; needed = mock.needed; } }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
function graph(): EffectOperatorGraph {
  const nodes = [
    { id: 'uv', operator: 'image.uv' }, { id: 'frame', operator: 'image.frame' },
    { id: 'delay-a', operator: 'values.number', constants: { value: .25 } },
    { id: 'delay-b', operator: 'values.number', constants: { value: .75 } },
    { id: 'a', operator: 'image.sample-history' }, { id: 'b', operator: 'image.sample-history' }, { id: 'out', operator: 'image.output' },
  ].map(node => ({ ...node, operatorVersion: 1, bindings: {} }));
  const edges = ['a', 'b'].flatMap(id => [['uv', 'uv', 'uv'], [`delay-${id}`, 'value', 'delay'], ['frame', 'image', 'current']]
    .map(([from, output, input]) => ({ id: `${id}:${input}`, from, output, to: id, input })));
  edges.push({ id: 'out', from: 'a', output: 'image', to: 'out', input: 'image' });
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges };
}
it('accumulates each query independently while decoding the union once within one cache budget', async () => {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_DST: 4 });
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2 });
  let textureId = 0;
  const createTexture = vi.fn(() => { const id = ++textureId; return { createView: () => ({ id }), destroy: vi.fn() }; });
  const device = { limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 }, createTexture,
    createBuffer: ({ size }: any) => ({ size, destroy: vi.fn() }), createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { writeTexture: vi.fn(), writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: async () => {} },
  } as unknown as GPUDevice;
  mock.accumulate.mockImplementation(() => ({ destroy: vi.fn() }));
  mock.needed.mockResolvedValueOnce([1]).mockResolvedValueOnce([2]);
  const runtime = new HybridTemporalRuntime(device);
  const request = { key: 'test', effectId: 'effect', media: { id: 'video', url: 'blob:video', width: 2, height: 1 },
    currentInput: { view: {}, width: 2, height: 1 }, encoder: {}, source: { mediaId: 'video', localTime: 2, duration: 10,
      inPoint: 0, outPoint: 10, speed: 1, speedKeyframes: [] }, horizon: 1, samples: 4, nearest: true } as SourceTemporalRequest;
  const context = { graph: graph(), queryIds: ['a', 'b'], sampler: {} as GPUSampler, timelineTime: 2,
    externalResources: new Map(), effect: { type: 'slit-scan', params: { temporalBatch: 'off' } } };
  const normal = hybridTemporalMemory(2, 1, 2, 1, 4, 256, 1000000, 2);
  const budget = normal.bytes - (normal.capacity - 1) * 8;
  for (let i = 0; i < 2; i++) {
    const finish = collectTemporalPreparations(); runtime.resolve(request, context, budget); await Promise.all(finish());
  }
  const result = runtime.resolve(request, context, budget)!;
  expect(Object.keys(result.queries)).toEqual(['a', 'b']);
  expect(result.queries.a.atlas.view).not.toEqual(result.queries.b.atlas.view);
  expect(mock.needed).toHaveBeenCalledTimes(2);
  const decoded = mock.request.mock.calls.flatMap(call => call[0]);
  expect(decoded).toHaveLength(2); expect(new Set(decoded).size).toBe(2);
  expect(mock.upload).toHaveBeenCalledTimes(2);
  const outputs = mock.accumulate.mock.calls.map(call => call[5].id);
  expect(new Set(outputs).size).toBe(2);
  const captures = mock.encode.mock.calls.map(call => call[0]);
  expect(captures.map(call => call.instanceId)).toEqual(['test:a:demand', 'test:a:current', 'test:b:demand', 'test:b:current']);
  const delays = captures.filter(call => call.instanceId.endsWith(':demand')).map(call =>
    call.plan.graph.edges.find((edge: any) => edge.to === '__native_demand_rgba' && edge.input === 'z').from);
  expect(delays).toEqual(['delay-a', 'delay-b']);
  expect(runtime.isCurrent('test')).toBe(true);
  runtime.destroy(); expect(mock.release).toHaveBeenCalledOnce();
});
