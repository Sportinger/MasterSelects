import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';
import { WorkerGpuNativeSceneOwner } from '../../src/services/render/WorkerGpuNativeSceneOwner';
import { WorkerNativeSceneDeadlineError } from '../../src/services/render/workerNativeSceneCatchUp';

const state = vi.hoisted(() => ({ target: 4, prepares: vi.fn() }));
vi.mock('../../src/engine/native3d/NativeSceneRuntime', () => ({
  NativeSceneRuntime: class { async initialize() {} dispose() {} },
}));
vi.mock('../../src/services/render/WorkerGpuNativeSceneAssets', () => ({
  WorkerGpuNativeSceneAssets: class { async prepare() {} require() {} dispose() {} },
}));
vi.mock('../../src/services/render/WorkerGpuNativeSceneAudio', () => ({
  WorkerGpuNativeSceneAudio: class { async prepare() {} require() {} dispose() {} },
}));
vi.mock('../../src/engine/flock/runtime/flockRuntimeStatus', () => ({
  buildFlockRuntimeStatus: () => ({}),
}));
vi.mock('../../src/engine/flock/runtime/FlockSimulationRuntime', () => ({
  FlockSimulationRuntime: class {
    entries = new Map();
    jobs = new Map();
    prepare() {
      const entry = this.entries.get('particles|preview') ?? {
        session: { step: 0 }, program: { diagnostics: [] }, runtimeDiagnostics: [],
      };
      entry.session.step += Math.min(4, state.target - entry.session.step);
      entry.caughtUp = entry.session.step === state.target;
      this.entries.set('particles|preview', entry);
      state.prepares(entry.session.step);
      return {};
    }
    dispose() {}
  },
}));

function fixture() {
  let complete!: () => void;
  const fence = new Promise<void>(resolve => { complete = resolve; });
  const queue = { submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => fence) };
  const device = { queue, limits: {}, features: new Set(), createCommandEncoder: () => ({ finish: () => ({}) }) };
  const owner = new WorkerGpuNativeSceneOwner(device as unknown as GPUDevice);
  const { stack } = nativeSceneFixture();
  return { owner, queue, complete, stack };
}

beforeEach(() => { state.target = 4; state.prepares.mockClear(); });

describe('Worker simulation submission ordering', () => {
  it('leaves the final simulation block queued for the compositor completion fence', async () => {
    const f = fixture();
    await f.owner.prepare(f.stack, () => true, () => 1000);
    expect(f.queue.submit).toHaveBeenCalledOnce();
    expect(f.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
    expect(f.owner.flockStatusSnapshot(f.stack).preparation).toMatchObject({ steps: 4, deferredSteps: 4, prepareCalls: 1, waitMs: 0 });
    f.owner.dispose();
  });

  it('bounds queued catch-up work by waiting before submitting another block', async () => {
    state.target = 8;
    const f = fixture();
    const preparing = f.owner.prepare(f.stack, () => true, () => 1000);
    await vi.waitFor(() => expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledOnce());
    expect(state.prepares).toHaveBeenCalledTimes(1);
    f.complete();
    await preparing;
    expect(state.prepares.mock.calls.map(call => call[0])).toEqual([4, 8]);
    expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(f.owner.flockStatusSnapshot(f.stack).preparation).toMatchObject({ steps: 8, deferredSteps: 4, prepareCalls: 2 });
    f.owner.dispose();
  });

  it('only reports completed GPU steps as resumable when the request expires', async () => {
    state.target = 8;
    const f = fixture();
    let now = 1000;
    const result = f.owner.prepare(f.stack, () => true, () => now).catch(error => error);
    await vi.waitFor(() => expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledOnce());
    now = f.stack.frame.expireAfterMs;
    f.complete();
    expect(await result).toMatchObject({ completedSteps: 4 });
    expect(state.prepares).toHaveBeenCalledTimes(1);
    f.owner.dispose();
  });

  it('does not claim a queued final block has completed if admission expires', async () => {
    const f = fixture();
    let now = 1000;
    f.queue.submit.mockImplementation(() => { now = f.stack.frame.expireAfterMs; });
    await expect(f.owner.prepare(f.stack, () => true, () => now))
      .rejects.toMatchObject({ completedSteps: 0 });
    f.owner.dispose();
  });

  it('rejects a replaced surface before scheduling further simulation', async () => {
    state.target = 8;
    const f = fixture();
    let current = true;
    const result = f.owner.prepare(f.stack, () => current, () => 1000).catch(error => error);
    await vi.waitFor(() => expect(f.queue.onSubmittedWorkDone).toHaveBeenCalledOnce());
    current = false;
    f.complete();
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(WorkerNativeSceneDeadlineError);
    expect(state.prepares).toHaveBeenCalledTimes(1);
    f.owner.dispose();
  });
});
