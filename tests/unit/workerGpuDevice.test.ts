import { describe, expect, it, vi } from 'vitest';
import { acquireWorkerGpuDevice } from '../../src/services/render/workerGpuDevice';

function fixture(timestamp = true) {
  // Match browser WebIDL: the values live on the prototype.
  const limits = Object.create({
    get maxStorageBufferBindingSize() { return 1_073_741_824; },
    get maxBufferSize() { return 2_147_483_648; },
  });
  const device = { features: new Set(timestamp ? ['timestamp-query'] : []), limits } as unknown as GPUDevice;
  const requestDevice = vi.fn(async (_descriptor?: GPUDeviceDescriptor) => device);
  const adapter = { features: device.features, limits, requestDevice } as unknown as GPUAdapter;
  return { requestDevice, gpu: { requestAdapter: vi.fn(async () => adapter) } };
}

describe('Worker GPU device capabilities', () => {
  it('enables supported timestamps and adapter buffer capacity on the actual device request', async () => {
    const fake = fixture();
    const acquired = await acquireWorkerGpuDevice({ gpu: fake.gpu });
    expect(acquired.ok).toBe(true);
    expect(fake.requestDevice).toHaveBeenCalledExactlyOnceWith({ requiredFeatures: ['timestamp-query'],
      requiredLimits: { maxStorageBufferBindingSize: 1_073_741_824, maxBufferSize: 2_147_483_648 } });
    expect(acquired.diagnostics.deviceFeatures).toEqual(['timestamp-query']);
    expect(acquired.diagnostics.adapterLimits.maxStorageBufferBindingSize).toBe(1_073_741_824);
    expect(acquired.diagnostics.deviceLimits.maxBufferSize).toBe(2_147_483_648);
  });

  it('supports adapters without timestamps without requesting an unsupported feature', async () => {
    const fake = fixture(false);
    expect((await acquireWorkerGpuDevice({ gpu: fake.gpu })).ok).toBe(true);
    expect(fake.requestDevice.mock.calls[0][0]?.requiredFeatures).toEqual([]);
  });

  it('preserves explicit descriptors, including an intentional default device', async () => {
    for (const descriptor of [{}, { requiredFeatures: ['shader-f16'] as GPUFeatureName[], requiredLimits: { maxBufferSize: 268435456 } }]) {
      const fake = fixture();
      await acquireWorkerGpuDevice({ gpu: fake.gpu, deviceDescriptor: descriptor });
      expect(fake.requestDevice).toHaveBeenCalledExactlyOnceWith(descriptor);
      expect(fake.requestDevice.mock.calls[0][0]).toBe(descriptor);
    }
  });

  it('reports a rejected device request without pretending that the requested features are active', async () => {
    const fake = fixture();
    fake.requestDevice.mockRejectedValueOnce(new Error('device unavailable'));
    const acquired = await acquireWorkerGpuDevice({ gpu: fake.gpu });
    expect(acquired.ok).toBe(false);
    expect(acquired.owner).toBeNull();
    expect(acquired.diagnostics).toMatchObject({ status: 'device-request-failed', deviceFeatures: [],
      deviceLimits: {}, error: 'device unavailable' });
  });
});
