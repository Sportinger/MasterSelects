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
  const originalPlatform = navigator.platform;
  const originalUserAgent = navigator.userAgent;
  const originalUserAgentData = (navigator as Navigator & { userAgentData?: unknown }).userAgentData;

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: originalGpu,
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: originalUserAgentData,
    });
  });

  function createDevice(): GPUDevice {
    return {
      lost: new Promise<GPUDeviceLostInfo>(() => {}),
      destroy: vi.fn(),
    } as unknown as GPUDevice;
  }

  function createAdapter(device = createDevice()): GPUAdapter {
    return {
      features: new Set(),
      limits: {
        maxTextureDimension2D: 8192,
        maxStorageBufferBindingSize: 2147483644,
        maxBufferSize: 2147483644,
      },
      requestDevice: vi.fn(async () => device),
    } as unknown as GPUAdapter;
  }

  function installGpu(requestAdapter: () => Promise<GPUAdapter | null>): void {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter, getPreferredCanvasFormat: () => 'rgba8unorm' },
    });
  }

  it('clears request timers after a successful normal initialization', async () => {
    vi.useFakeTimers();
    const requestAdapter = vi.fn(async () => createAdapter());
    installGpu(requestAdapter);
    expect(await new WebGPUContext().initialize()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows another normal initialization after adapters were temporarily unavailable', async () => {
    const requestAdapter = vi.fn<() => Promise<GPUAdapter | null>>().mockResolvedValue(null);
    installGpu(requestAdapter);
    const context = new WebGPUContext();
    expect(await context.initialize()).toBe(false);
    requestAdapter.mockClear().mockResolvedValue(createAdapter());
    expect(await context.initialize()).toBe(true);
    expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({ powerPreference: 'high-performance' });
  });

  it('lets a slow normal adapter and device finish without requesting a fallback', async () => {
    vi.useFakeTimers();
    const device = createDevice();
    const adapter = createAdapter(device);
    vi.mocked(adapter.requestDevice).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(device), 2500)));
    const requestAdapter = vi.fn(() =>
      new Promise<GPUAdapter>(resolve => setTimeout(() => resolve(adapter), 2500)));
    installGpu(requestAdapter);
    const context = new WebGPUContext();
    const initialization = context.initialize();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await initialization).toBe(true);
    expect(context.getDevice()).toBe(device);
    expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({ powerPreference: 'high-performance' });
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('does not issue another device request on a pending adapter and destroys a late device', async () => {
    vi.useFakeTimers();
    const device = createDevice();
    const adapter = createAdapter(device);
    let complete!: (device: GPUDevice) => void;
    vi.mocked(adapter.requestDevice).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    installGpu(vi.fn(async () => adapter));
    const context = new WebGPUContext();
    const initialization = context.initialize();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await initialization).toBe(false);
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    complete(device);
    await vi.advanceTimersByTimeAsync(0);
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(context.getDevice()).toBeNull();
  });

  it('cannot resurrect a destroyed context when its device arrives later', async () => {
    vi.useFakeTimers();
    const device = createDevice();
    const adapter = createAdapter(device);
    let complete!: (device: GPUDevice) => void;
    vi.mocked(adapter.requestDevice).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    installGpu(vi.fn(async () => adapter));
    const context = new WebGPUContext();
    const initialization = context.initialize();
    await vi.advanceTimersByTimeAsync(0);
    context.destroy();
    complete(device);
    expect(await initialization).toBe(false);
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(context.getDevice()).toBeNull();
  });

  it('reports an adapter timeout without misclassifying it as an unavailable GPU', async () => {
    vi.useFakeTimers();
    const requestAdapter = vi.fn(() => new Promise<GPUAdapter | null>(() => {}));
    installGpu(requestAdapter);
    const context = new WebGPUContext();
    const result = context.initialize();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toBe(false);
    expect(context.getInitializationFailure()).toBe('adapter_timeout');
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  function installRecoverableDevice() {
    let lose!: (info: GPUDeviceLostInfo) => void;
    const device = createDevice();
    Object.defineProperty(device, 'lost', { value: new Promise(resolve => { lose = resolve; }) });
    const requestAdapter = vi.fn<() => Promise<GPUAdapter | null>>().mockResolvedValue(createAdapter(device));
    installGpu(requestAdapter);
    return { device, requestAdapter, lose };
  }

  it('retries transient recovery failures and waits for engine resources before finishing', async () => {
    vi.useFakeTimers();
    const { device, requestAdapter, lose } = installRecoverableDevice();
    const context = new WebGPUContext();
    expect(await context.initialize()).toBe(true);
    requestAdapter.mockResolvedValue(null);
    let restore!: () => void;
    const restored = vi.fn(() => new Promise<void>(resolve => { restore = resolve; }));
    context.onDeviceRestored(restored);
    const failed = vi.fn();
    context.onRecoveryFailed(failed);
    lose({ reason: 'unknown', message: 'driver reset' });
    await vi.advanceTimersByTimeAsync(101);
    expect(context.getDevice()).toBeNull();
    expect(context.recovering).toBe(true);
    const replacement = createDevice();
    requestAdapter.mockResolvedValue(createAdapter(replacement));
    await vi.advanceTimersByTimeAsync(201);
    expect(context.getDevice()).toBe(replacement);
    expect(context.getDevice()).not.toBe(device);
    expect(restored).toHaveBeenCalledOnce();
    expect(context.recovering).toBe(true);
    restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.recovering).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it('terminates recovery after three failed attempts and reports the failure', async () => {
    vi.useFakeTimers();
    const { requestAdapter, lose } = installRecoverableDevice();
    const context = new WebGPUContext();
    await context.initialize();
    requestAdapter.mockResolvedValue(null);
    const failed = vi.fn();
    context.onRecoveryFailed(failed);
    lose({ reason: 'unknown', message: 'driver reset' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(failed).toHaveBeenCalledExactlyOnceWith('adapter_unavailable');
    expect(context.recovering).toBe(false);
    expect(context.initialized).toBe(false);
    expect(context.getDevice()).toBeNull();
    const calls = requestAdapter.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestAdapter).toHaveBeenCalledTimes(calls);
  });

  it('ends recovery on timeout without stacking more pending GPU requests', async () => {
    vi.useFakeTimers();
    const { requestAdapter, lose } = installRecoverableDevice();
    const context = new WebGPUContext();
    await context.initialize();
    requestAdapter.mockImplementation(() => new Promise(() => {}));
    const failed = vi.fn();
    context.onRecoveryFailed(failed);
    lose({ reason: 'unknown', message: 'driver reset' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestAdapter).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledExactlyOnceWith('adapter_timeout');
    expect(context.recovering).toBe(false);
  });

  it('does not restart a context destroyed during the recovery delay', async () => {
    vi.useFakeTimers();
    const { requestAdapter, lose } = installRecoverableDevice();
    const context = new WebGPUContext();
    await context.initialize();
    lose({ reason: 'unknown', message: 'driver reset' });
    await vi.advanceTimersByTimeAsync(0);
    context.destroy();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(context.recovering).toBe(false);
    expect(context.getDevice()).toBeNull();
  });

  it('requests large storage buffer limits when the adapter supports them', async () => {
    const device = createDevice();
    const requestDevice = vi.fn(async () => device);
    const adapter = {
      features: new Set(),
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

  it('enables optional core and subgroup features when the adapter exposes them', async () => {
    const device = createDevice();
    const requestDevice = vi.fn(async () => device);
    const adapter = {
      features: new Set(['core-features-and-limits', 'subgroups']),
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
      requiredFeatures: ['core-features-and-limits', 'subgroups'],
    }));
  });

  it('uses low-power fallback on Linux when high-performance adapter selection fails', async () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    });

    const adapter = createAdapter();
    const requestAdapter = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adapter);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const fallbackCallback = vi.fn();
    context.onPowerPreferenceFallback(fallbackCallback);
    const success = await context.initialize('high-performance');

    expect(success).toBe(true);
    expect(requestAdapter).toHaveBeenNthCalledWith(1, { powerPreference: 'high-performance' });
    expect(requestAdapter).toHaveBeenNthCalledWith(2, { powerPreference: 'low-power' });
    expect(context.getPowerPreference()).toBe('low-power');
    expect(fallbackCallback).toHaveBeenCalledWith('low-power');
  });

  it('keeps the no-preference fallback on Windows instead of forcing low-power', async () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const adapter = createAdapter();
    const requestAdapter = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adapter);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const fallbackCallback = vi.fn();
    context.onPowerPreferenceFallback(fallbackCallback);
    const success = await context.initialize('high-performance');

    expect(success).toBe(true);
    expect(requestAdapter).toHaveBeenNthCalledWith(1, { powerPreference: 'high-performance' });
    expect(requestAdapter).toHaveBeenNthCalledWith(2);
    expect(requestAdapter).not.toHaveBeenCalledWith({ powerPreference: 'low-power' });
    expect(context.getPowerPreference()).toBe('high-performance');
    expect(fallbackCallback).not.toHaveBeenCalled();
  });

  it('requests the normal Android adapter before compatibility mode and skips powerPreference', async () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux armv8l',
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/146.0.0.0',
    });

    const adapter = createAdapter();
    const requestAdapter = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(adapter);
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const context = new WebGPUContext();
    const success = await context.initialize('high-performance');

    expect(success).toBe(true);
    expect(requestAdapter).toHaveBeenNthCalledWith(1);
    expect(requestAdapter).toHaveBeenNthCalledWith(2, { featureLevel: 'compatibility' });
    expect(requestAdapter).not.toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(requestAdapter).not.toHaveBeenCalledWith({ powerPreference: 'low-power' });
  });
});
