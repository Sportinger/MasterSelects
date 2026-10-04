import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  encode: vi.fn((_options: { instanceId?: string }) => true),
}));

vi.mock('../../src/effects/ComputeEffectRuntime', () => ({
  ComputeEffectRuntime: class {
    encode = mocks.encode;
    clear() {}
  },
}));

import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';

// Nested compositions keep their original effect ids. Analog Signal Lab keeps per-instance
// stage uniforms (written with queue.writeBuffer) and signal textures, so two visible
// occurrences of one nested comp must not resolve to the same runtime instance.
describe('EffectsPipeline compute instance scoping', () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('keys analog-signal instances by render scope and effect id', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2, COMPUTE: 4 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const device = { limits: { maxSampledTexturesPerShaderStage: 16 }, lost: new Promise(() => {}),
      queue: { writeBuffer: vi.fn() }, createShaderModule: vi.fn(() => ({})), createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({})), createComputePipeline: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })), createSampler: vi.fn(() => ({})) } as unknown as GPUDevice;
    const pipeline = new EffectsPipeline(device), encoder = {} as GPUCommandEncoder, sampler = {} as GPUSampler;
    const view = (id: string) => ({ id }) as unknown as GPUTextureView;
    const effect = { id: 'analog-fx', type: 'analog-signal-lab', name: 'Analog Signal Lab', enabled: true,
      params: {}, operatorGraph: createDefaultAnalogSignalGraph() };
    const apply = (clockScopeId: string, historyScopeId?: string) => pipeline.applyEffects(encoder, [effect], sampler,
      view('input'), view('output'), view('ping'), view('pong'), 16, 9, undefined, undefined, undefined, 0,
      historyScopeId ? { scopeId: historyScopeId, eventRevision: 0, ownerRevision: 0 } : undefined,
      { frameRate: 30, scopeId: clockScopeId });

    apply('["nested-occurrence-a","layer"]');
    apply('["nested-occurrence-b","layer"]');
    apply('clock-scope', '["timeline","layer"]');

    const instanceIds = mocks.encode.mock.calls.map(([options]) => options.instanceId);
    expect(instanceIds).toEqual([
      JSON.stringify(['["nested-occurrence-a","layer"]', 'analog-fx']),
      JSON.stringify(['["nested-occurrence-b","layer"]', 'analog-fx']),
      JSON.stringify(['["timeline","layer"]', 'analog-fx']),
    ]);
  });
});
