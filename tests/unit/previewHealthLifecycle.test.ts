import { afterEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  let release!: () => void;
  return {
    loaded: vi.fn(),
    getStats: vi.fn(() => ({ fps: 30, targetFps: 30, layerCount: 0 })),
    getTelemetry: vi.fn(() => ({ mode: 'main' })),
    getCaptureCanvas: vi.fn(() => { throw new Error('Synchronous GPU readback during playback'); }),
    ready: new Promise<void>((resolve) => { release = resolve; }),
    release: () => release(),
  };
});

vi.mock('../../src/services/render/renderHostPort', async () => {
  host.loaded();
  await host.ready;
  return { renderHostPort: { getStats: host.getStats, getTelemetry: host.getTelemetry, getCaptureCanvas: host.getCaptureCanvas } };
});
vi.mock('../../src/services/productAnalytics', () => ({ productAnalytics: { track: vi.fn() } }));

afterEach(() => { vi.useRealTimers(); });

it('defers render initialization and cannot restart a stopped session when loading finishes', async () => {
  const telemetry = await import('../../src/services/previewHealth/previewHealthTelemetry');
  expect(host.loaded).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    telemetry.startPreviewHealthSession();
    telemetry.startPreviewHealthSession();
    expect(vi.getTimerCount()).toBe(1);
    await vi.waitFor(() => expect(host.loaded).toHaveBeenCalledOnce());
    telemetry.stopPreviewHealthSession();
    host.release();
    await import('../../src/services/render/renderHostPort');
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.getStats).not.toHaveBeenCalled();

    telemetry.startPreviewHealthSession();
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.getStats).toHaveBeenCalledTimes(2);
    expect(host.getCaptureCanvas).not.toHaveBeenCalled();
    telemetry.stopPreviewHealthSession();
    expect(vi.getTimerCount()).toBe(0);

    const { productAnalytics } = await import('../../src/services/productAnalytics');
    vi.mocked(productAnalytics.track).mockClear();
    telemetry.startPreviewHealthSession();
    await vi.advanceTimersByTimeAsync(1000);
    host.getTelemetry.mockReturnValue({ mode: 'worker-only' });
    await vi.advanceTimersByTimeAsync(1000);
    telemetry.stopPreviewHealthSession();
    expect(vi.mocked(productAnalytics.track).mock.calls.map(([, properties]) => properties))
      .toEqual([
        expect.objectContaining({ renderer: 'main', samples: 2, telemetry_version: 2 }),
        expect.objectContaining({ renderer: 'worker-only', samples: 2, telemetry_version: 2 }),
      ]);
  } finally {
    telemetry.stopPreviewHealthSession();
  }
});
