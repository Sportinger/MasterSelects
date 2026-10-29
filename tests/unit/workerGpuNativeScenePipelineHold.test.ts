import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGpuPipelineFailures, guardGpuDevice } from '../../src/engine/core/gpuPipelineGuard';
import { WorkerGpuNativeSceneOwner } from '../../src/services/render/WorkerGpuNativeSceneOwner';
import { safariDevice, stubFlockGpuGlobals } from '../fixtures/flockSafariDevice';
import { nativeSceneFixture } from '../fixtures/workerNativeScene';

// The real FlockSimulationRuntime and FlockGpuSession run here: a new session returns
// no plan while its pipeline verdicts are pending, which the worker must hold, not fail.
vi.mock('../../src/engine/native3d/NativeSceneRuntime', () => ({
  NativeSceneRuntime: class { async initialize() {} dispose() {} },
}));
vi.mock('../../src/services/render/WorkerGpuNativeSceneAssets', () => ({
  WorkerGpuNativeSceneAssets: class {
    registry = { model: () => ({}), pigment: () => ({ view: {}, sampler: {} }) };
    async prepare() {} require() {} modelState() { return null; } dispose() {}
  },
}));
vi.mock('../../src/services/render/WorkerGpuNativeSceneAudio', () => ({
  WorkerGpuNativeSceneAudio: class {
    async prepare() {} require() {} sampler() { return () => null; } fingerprint() { return ''; } dispose() {}
  },
}));
vi.mock('../../src/engine/flock/runtime/flockCheckpointStore', () => ({
  flockCheckpointStore: { listSteps: async () => [], get: async () => null, pruneClip: async () => undefined },
}));

function owner(failing: RegExp) {
  const { device, errors } = safariDevice(failing);
  guardGpuDevice(device, 'render-worker');
  return { owner: new WorkerGpuNativeSceneOwner(device), errors };
}

beforeEach(() => { stubFlockGpuGlobals(); clearGpuPipelineFailures('render-worker'); });
afterEach(() => { vi.unstubAllGlobals(); clearGpuPipelineFailures('render-worker'); });

describe('worker native scene and flock pipeline verdicts', () => {
  it.each(['preview', 'export'] as const)('holds a new %s session until its verdicts arrive, then prepares the frame', async (intent) => {
    const { owner: sceneOwner, errors } = owner(/^$/);
    const { stack } = nativeSceneFixture(0.05);
    stack.frame.intent = intent;
    await sceneOwner.prepare(stack, () => true, () => 1000);
    const statuses = sceneOwner.flockStatusSnapshot(stack).occurrences.flatMap(occurrence => occurrence.statuses);
    expect(statuses).toEqual([expect.objectContaining({ clipId: 'particles', state: 'ready' })]);
    expect(errors).toEqual([]);
    sceneOwner.dispose();
  });

  it('fails the frame with the readable message when a required pipeline is rejected', async () => {
    const { owner: sceneOwner, errors } = owner(/^flock-simulate$/);
    const { stack } = nativeSceneFixture(0.05);
    await expect(sceneOwner.prepare(stack, () => true, () => 1000))
      .rejects.toThrow(/flock-simulate \(validation\); the simulation does not run on this device/);
    expect(errors).toEqual([]);
    sceneOwner.dispose();
  });
});
