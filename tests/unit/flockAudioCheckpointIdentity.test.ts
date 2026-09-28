import { describe, expect, it, vi } from 'vitest';
import { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import type { FlockSimulationHost } from '../../src/engine/flock/runtime/flockSimulationHost';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';

vi.mock('../../src/engine/flock/gpu/FlockGpuPipelines', () => ({ getFlockGpuPipelines: () => ({}) }));
vi.mock('../../src/engine/flock/gpu/FlockGpuSession', () => ({
  estimateFlockSessionBuffers: () => ({ largestBinding: 16 }),
  FlockGpuSession: class {
    device: GPUDevice; isDisposed = false; invalidateFrom = vi.fn(); setContext = vi.fn(); dispose = vi.fn();
    constructor(device: GPUDevice) { this.device = device; }
  },
}));
vi.mock('../../src/engine/flock/runtime/flockCheckpointStore', () => ({ flockCheckpointStore: { listSteps: async () => [] } }));

function program() {
  const graph = new FlockGraphBuilder();
  const emitter = graph.add('flock.emitter', { count: 8 });
  const simulation = graph.add('flock.simulation');
  const audio = graph.add('flock.audio', { clipId: 'music' });
  const attractor = graph.add('flock.attractor');
  const render = graph.add('flock.render-points');
  const output = graph.add('flock.output');
  graph.connect(emitter, 'spawn', simulation, 'spawn').connect(simulation, 'particles', render, 'particles')
    .connect(render, 'scene', output, 'scene').connect(audio, 'value', attractor, 'strength').connect(attractor, 'behavior', simulation, 'behavior');
  const result = compileFlockDefinition(graph.build('audio-cache'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

describe('audio simulation checkpoint identity', () => {
  it.each([
    ['checkpoint', false], ['gpu', false], ['checkpoint', true], ['gpu', true],
  ])('rejects an audio change during export %s preparation (session refreshed: %s)', async (boundary, refreshed) => {
    let fingerprint = 'before';
    const host: FlockSimulationHost = { requestRender: () => {}, renderAssets: () => { throw new Error('unused'); },
      audioRevision: () => 0, audioFingerprint: () => fingerprint, audioSampler: () => () => 0.5, modelState: () => null,
      status: { getStatus: () => null, publishStatus: () => {}, clearStatus: () => {} } };
    const runtime = new FlockSimulationRuntime(host), graph = program();
    const session = { step: 0, isDisposed: false, seekCheckpoint: vi.fn(),
      advanceTo: vi.fn((step: number) => { session.step = step; }) };
    const entry = { session, audioFingerprint: 'before' };
    const changeAudio = () => {
      fingerprint = 'after';
      // Another request can acquire the same export session while this one awaits IO.
      if (refreshed) entry.audioFingerprint = fingerprint;
    };
    vi.spyOn(runtime, 'acquire').mockReturnValue(entry as any);
    vi.spyOn(runtime, 'loadPersistedCheckpoint').mockImplementation(async () => { if (boundary === 'checkpoint') changeAudio(); });
    const device = { queue: { onSubmittedWorkDone: async () => { changeAudio(); } } } as unknown as GPUDevice;
    await expect(runtime.prepareForExport(device, [{ clipId: 'flock', program: graph, definition: {} as any,
      diagnostics: [], keyframes: [], consumer: 'export', sourceTime: 0.2 }])).rejects.toThrow('Audio input changed');
    expect(session.advanceTo).toHaveBeenCalledTimes(boundary === 'gpu' ? 1 : 0);
  });

  it('separates analysis/placement changes and preserves deterministic keys across fresh runtimes', () => {
    let fingerprint = 'curve-A:placement-0';
    const host: FlockSimulationHost = { requestRender: () => {}, renderAssets: () => { throw new Error('unused'); },
      audioRevision: () => 0, audioFingerprint: () => fingerprint, audioSampler: () => () => 0.5, modelState: () => null,
      status: { getStatus: () => null, publishStatus: () => {}, clearStatus: () => {} } };
    const device = { limits: { maxStorageBufferBindingSize: 1024, maxBufferSize: 1024 } } as GPUDevice;
    const graph = program(), runtime = new FlockSimulationRuntime(host);
    const initial = runtime.acquire(device, 'flock', 'preview', graph, [])!;
    const firstKey = initial.cacheKey;
    runtime.acquire(device, 'flock', 'preview', graph, []);
    expect(initial.session.invalidateFrom).not.toHaveBeenCalled();
    fingerprint = 'curve-A:placement-1';
    runtime.acquire(device, 'flock', 'preview', graph, []);
    expect(initial.session.invalidateFrom).toHaveBeenCalledWith(0);
    expect(initial.cacheKey).not.toBe(firstKey);
    const secondKey = initial.cacheKey;
    fingerprint = 'curve-B:placement-1';
    runtime.acquire(device, 'flock', 'preview', graph, []);
    expect(initial.cacheKey).not.toBe(secondKey);
    const fresh = new FlockSimulationRuntime(host);
    expect(fresh.acquire(device, 'flock', 'preview', graph, [])!.cacheKey).toBe(initial.cacheKey);
    runtime.dispose(); fresh.dispose();
  });
});
