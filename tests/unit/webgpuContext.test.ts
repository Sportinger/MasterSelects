import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebGPUContext } from '../../src/engine/core/WebGPUContext';

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe('WebGPUContext', () => {
  const originalGpu = navigator.gpu;

  afterEach(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: originalGpu,
    });
  });

  it('requests large storage buffer limits when the adapter supports them', async () => {
    const device = {
      lost: new Promise<GPUDeviceLostInfo>(() => {}),
      destroy: vi.fn(),
    } as unknown as GPUDevice;

    const requestDevice = vi.fn(async () => device);
    const adapter = {
      limits: {
        maxTextureDimension2D: 8192,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      },
      requestDevice,
    } as unknown as GPUAdapter;

    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const success = await context.initialize();

    expect(success).toBe(true);
    expect(requestDevice).toHaveBeenCalledWith(expect.objectContaining({
      requiredFeatures: [],
      requiredLimits: expect.objectContaining({
        maxTextureDimension2D: 4096,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      }),
    }));
  });
});
