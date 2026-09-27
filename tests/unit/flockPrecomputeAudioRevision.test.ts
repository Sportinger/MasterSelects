import { describe, expect, it, vi } from 'vitest';
import { runFlockPrecompute } from '../../src/engine/flock/runtime/flockPrecompute';
import type { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';
const stored = vi.hoisted(() => ({ put: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../src/engine/flock/runtime/flockCheckpointStore', () => ({ flockCheckpointStore: stored }));

describe('audio changes during asynchronous precompute', () => {
  it.each(['gpu', 'readback'])('cancels after %s instead of persisting a mixed-audio cache', async boundary => {
    stored.put.mockClear();
    const fixture = nativeSceneFixture(0.2, 1000, 'audio', undefined, true);
    const layer = fixture.payload.layers[0];
    if (layer.kind !== 'flock') throw new Error('Invalid fixture');
    const program = compileFlockDefinition(layer.definition).program!;
    let fingerprint = 'before';
    const session = { step: 0, checkpointInterval: 1, isDisposed: false, dispose: vi.fn(),
      advanceTo(step: number) { this.step = step; }, listCheckpointSteps: () => [15],
      readCheckpoint: async () => { if (boundary === 'readback') fingerprint = 'after'; return { state: new ArrayBuffer(4), rings: [] }; } };
    const worker = { session, audioFingerprint: 'before', cacheKey: 'old-key', key: 'flock|precompute' };
    const registry = { device: { queue: { onSubmittedWorkDone: async () => { if (boundary === 'gpu') fingerprint = 'after'; } } },
      latestInputs: new Map([['flock', { program, keyframes: [] }]]), jobs: new Map(), entries: new Map(), acquire: () => worker,
      host: { audioFingerprint: () => fingerprint, requestRender: vi.fn(), status: { getStatus: () => null, publishStatus: vi.fn() } } };
    const result = await runFlockPrecompute(registry as unknown as FlockSimulationRuntime, 'flock', { start: 0, end: 0.5 }, { persist: true });
    expect(result).toEqual({ ok: false, message: 'Audio input changed; restart precompute.' });
    expect(stored.put).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(registry.jobs.get('flock').finished).toBe(true);
  });
});
