import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neighborFixture } from '../fixtures/flockNeighborFixtures';
import { flockCheckpointBudget } from '../../src/engine/flock/gpu/FlockGpuCheckpoints';

const storage = vi.hoisted(() => ({ put: vi.fn(), pruneClip: vi.fn() }));
vi.mock('../../src/engine/flock/runtime/flockCheckpointStore', () => ({ flockCheckpointStore: storage }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestRender: vi.fn() } }));
vi.mock('../../src/engine/flock/runtime/flockRuntimeApi', () => ({ flockRuntime: { publishStatus: vi.fn(), getStatus: vi.fn() } }));
vi.mock('../../src/engine/flock/runtime/flockRuntimeStatus', () => ({ buildFlockRuntimeStatus: vi.fn(() => ({})) }));
import { runFlockPrecompute } from '../../src/engine/flock/runtime/flockPrecompute';
import type { FlockSimulationRegistry } from '../../src/engine/flock/runtime/FlockSimulationRegistry';

function fixture() {
  const program = neighborFixture('none');
  const session = {
    step: 0, checkpointInterval: 15, isDisposed: false, latest: 0,
    advanceTo(step: number) { this.step = step; this.latest = Math.floor(step / this.checkpointInterval) * this.checkpointInterval; },
    listCheckpointSteps() { return this.latest ? [this.latest] : []; },
    async readCheckpoint(step: number) { return step === this.latest ? { state: new Uint32Array([step]).buffer, rings: [] } : null; },
    dispose() { this.isDisposed = true; },
  };
  const preview = { cacheKey: 'current', persistedSteps: [] as number[], session: { adoptCheckpoints: vi.fn() } };
  const worker = { key: 'clip|precompute', cacheKey: 'current', session };
  const registry = {
    host: { requestRender: vi.fn(), status: { publishStatus: vi.fn(), getStatus: vi.fn() } },
    device: { queue: { onSubmittedWorkDone: async () => {} } },
    latestInputs: new Map([['clip', { program, keyframes: [] }]]),
    jobs: new Map(), entries: new Map<string, unknown>([['clip|preview', preview], [worker.key, worker]]),
    acquire: () => worker,
  };
  return { registry: registry as unknown as FlockSimulationRegistry, session, preview };
}

beforeEach(() => { vi.clearAllMocks(); storage.put.mockResolvedValue({ ok: true }); storage.pruneClip.mockResolvedValue(0); });

describe('bounded checkpoint persistence', () => {
  it('streams every interval before a one-snapshot GPU cache evicts it', async () => {
    const { registry, session, preview } = fixture();
    const result = await runFlockPrecompute(registry, 'clip', { start: 0, end: 6 }, { persist: true });
    expect(result.ok).toBe(true);
    const steps = storage.put.mock.calls.map(([record]) => record.step);
    expect(steps).toEqual(Array.from({ length: 24 }, (_, i) => (i + 1) * 15));
    expect(preview.persistedSteps).toEqual(steps);
    expect(session.isDisposed).toBe(true);
  });

  it('stops on storage failure without claiming 100 percent completion', async () => {
    storage.put.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: 'quota exceeded' });
    const { registry, session, preview } = fixture();
    const result = await runFlockPrecompute(registry, 'clip', { start: 0, end: 6 }, { persist: true });
    expect(result).toMatchObject({ ok: false, message: 'quota exceeded' });
    expect(preview.persistedSteps).toEqual([15]);
    expect(registry.jobs.get('clip')?.progress).toBeLessThan(1);
    expect(session.isDisposed).toBe(true);
  });

  it('does not prune a newer graph cache when an older job finishes', async () => {
    const { registry, preview } = fixture();
    storage.put.mockImplementation(async () => { preview.cacheKey = 'newer'; return { ok: true }; });
    expect((await runFlockPrecompute(registry, 'clip', { start: 0, end: 1 }, { persist: true })).ok).toBe(true);
    expect(storage.pruneClip).not.toHaveBeenCalled();
  });

  it('keeps persistence optional', async () => {
    const { registry } = fixture();
    expect((await runFlockPrecompute(registry, 'clip', { start: 0, end: 1 }, { persist: false })).ok).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('scales GPU retention with the complete snapshot including affine/trail state', () => {
    expect(flockCheckpointBudget(1024)).toBe(16 * 1024 * 1024);
    expect(flockCheckpointBudget(154_857_600)).toBe(256 * 1024 * 1024);
    expect(flockCheckpointBudget(400 * 1024 * 1024)).toBe(400 * 1024 * 1024);
  });
});
