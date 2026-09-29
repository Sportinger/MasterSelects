import { afterEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  let release!: () => void;
  return {
    loaded: vi.fn(),
    getStats: vi.fn(() => ({ fps: 30, targetFps: 30, layerCount: 0 })),
    ready: new Promise<void>((resolve) => { release = resolve; }),
    release: () => release(),
  };
});

vi.mock('../../src/services/render/renderHostPort', async () => {
  host.loaded();
  await host.ready;
  return { renderHostPort: { getStats: host.getStats, getCaptureCanvas: () => null } };
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
    telemetry.stopPreviewHealthSession();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    telemetry.stopPreviewHealthSession();
  }
});
