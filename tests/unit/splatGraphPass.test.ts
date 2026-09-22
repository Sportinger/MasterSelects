import { describe, expect, it, vi } from 'vitest';
import { SplatGraphPass } from '../../src/engine/gaussian/graph/SplatGraphPass';
import type { SplatSceneGpuResources } from '../../src/engine/gaussian/core/splatRenderer/sceneResources';
import type { SplatCameraParams } from '../../src/engine/gaussian/core/splatRenderer/cameraUniforms';
import type { SplatGraphOperation } from '../../src/types/splatGraph';

const mocks = vi.hoisted(() => ({ order: vi.fn(), compute: vi.fn(() => ({})) }));
vi.mock('../../src/engine/gaussian/graph/SplatBranchSortCache', () => ({ SplatBranchSortCache: class {
  prepare = mocks.order; beginFrame() {} release() {} dispose() {}
} }));
vi.mock('../../src/engine/gaussian/graph/SplatGraphCompute', async importOriginal => ({
  ...await importOriginal<object>(), SplatGraphCompute: class { execute = mocks.compute; beginFrame() {} dispose() {} },
}));

describe('splat graph sorting policy', () => {
  const source = new Float32Array(140);
  const buffer = {} as GPUBuffer;
  const scene = { splatBuffer: buffer, workerSorter: {}, workerSortedBindGroup: {} } as SplatSceneGpuResources;
  const camera = { viewMatrix: new Float32Array(16) } as SplatCameraParams;
  function run(operations: SplatGraphOperation[], precise = false, workerAvailable = true) {
    mocks.order.mockReset(); mocks.order.mockReturnValue({ ...scene, workerSorter: workerAvailable ? {} : null });
    return new SplatGraphPass().execute({} as GPUDevice, {} as GPUCommandEncoder, {} as GPUBindGroupLayout,
      'asset', scene, buffer, 10, source, { id: 'surface', applyClipTransform: true, operations, budget: 5 },
      1, new Float32Array(16), camera, precise);
  }
  it('keeps unchanged centers on the worker path after budget remapping and attribute changes', () => {
    expect(run([{ kind: 'limit', values: [0.001, 0.03] }, { kind: 'noise', values: [2] }]).forceGpuSort).toBe(false);
    expect(mocks.order).toHaveBeenCalledOnce();
  });
  it('sorts moving particles and position noise on the GPU', () => {
    expect(run([{ kind: 'particles', values: [] }]).forceGpuSort).toBe(true);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(run([{ kind: 'noise', values: [0] }]).forceGpuSort).toBe(true);
  });
  it('preserves precise export sorting and falls back when the worker cannot initialize', () => {
    expect(run([], true).forceGpuSort).toBe(true);
    expect(mocks.order).not.toHaveBeenCalled();
    expect(run([], false, false).forceGpuSort).toBe(true);
  });
});
