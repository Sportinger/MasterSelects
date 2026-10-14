import { describe, expect, it, vi } from 'vitest';
import { allocateDisGpuResource } from '../../src/effects/time/disGpuAllocation';

function device() {
  return { pushErrorScope: vi.fn(), popErrorScope: vi.fn().mockResolvedValue(null) };
}

describe('DIS GPU allocation failures', () => {
  it('balances both scopes and returns valid resources', async () => {
    const gpu = device(), resource = {}, release = vi.fn();
    expect(await allocateDisGpuResource(gpu as unknown as GPUDevice, 'DIS', () => resource, release)).toBe(resource);
    expect(gpu.popErrorScope).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
  });

  it('releases a resource rejected by GPU validation', async () => {
    const gpu = device(), resource = {}, release = vi.fn();
    gpu.popErrorScope.mockResolvedValueOnce({ message: 'texture too large' });
    await expect(allocateDisGpuResource(gpu as unknown as GPUDevice, 'DIS allocation', () => resource, release))
      .rejects.toThrow('DIS allocation: texture too large');
    expect(release).toHaveBeenCalledExactlyOnceWith(resource);
  });

  it('preserves the allocation exception while draining rejected scopes', async () => {
    const gpu = device(), failure = new Error('allocation failed'), release = vi.fn();
    gpu.popErrorScope.mockRejectedValueOnce(new Error('device lost'));
    await expect(allocateDisGpuResource(gpu as unknown as GPUDevice, 'DIS', () => { throw failure; }, release))
      .rejects.toBe(failure);
    expect(gpu.popErrorScope).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
  });

  it('releases completed allocations when scope retrieval fails', async () => {
    const gpu = device(), resource = {}, release = vi.fn();
    gpu.popErrorScope.mockRejectedValueOnce(new Error('device lost'));
    await expect(allocateDisGpuResource(gpu as unknown as GPUDevice, 'DIS', () => resource, release))
      .rejects.toThrow('DIS: device lost');
    expect(release).toHaveBeenCalledExactlyOnceWith(resource);
  });
});
