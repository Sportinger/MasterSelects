import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportCanvasManager } from '../../src/engine/managers/ExportCanvasManager';

describe('export canvas capture recovery', () => {
  const configure = vi.fn();
  const capture = vi.fn();
  let manager: ExportCanvasManager;
  let device: GPUDevice;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      getContext() { return { configure }; }
    });
    vi.stubGlobal('VideoFrame', class {
      constructor(canvas: unknown, options: unknown) { capture(canvas, options); }
    });
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    device = { queue: { onSubmittedWorkDone: vi.fn(async () => {}) } } as unknown as GPUDevice;
    manager = new ExportCanvasManager();
    manager.initExportCanvas(device, 1920, 1080);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('captures a completed frame with the requested timing', async () => {
    await expect(manager.createVideoFrameFromExport(device, 1000, 33)).resolves.toBeTruthy();
    expect(capture).toHaveBeenCalledWith(manager.getExportCanvas(), {
      timestamp: 1000, duration: 33, alpha: 'discard',
    });
    expect(device.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
  });

  it('falls back after one unsupported capture and retries only for a new export canvas', async () => {
    capture.mockImplementationOnce(() => { throw new TypeError('Overload resolution failed'); });
    await expect(manager.createVideoFrameFromExport(device, 0, 33)).resolves.toBeNull();
    await expect(manager.createVideoFrameFromExport(device, 33, 33)).resolves.toBeNull();
    expect(capture).toHaveBeenCalledTimes(1);

    manager.initExportCanvas(device, 1280, 720);
    await expect(manager.createVideoFrameFromExport(device, 0, 33)).resolves.toBeTruthy();
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it.each(['cleanup', 'replace'])('snapshots the submitted canvas before %s can race capture', async (action) => {
    const submittedCanvas = manager.getExportCanvas();
    const pending = manager.createVideoFrameFromExport(device, 0, 33);
    expect(capture).toHaveBeenCalledWith(submittedCanvas, { timestamp: 0, duration: 33, alpha: 'discard' });
    if (action === 'cleanup') manager.cleanupExportCanvas();
    else manager.initExportCanvas(device, 1280, 720);
    await expect(pending).resolves.toBeTruthy();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(device.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
  });

  it('selects compositor readback on desktop Linux even when a GPU canvas would succeed', () => {
    const canvas = manager.getExportCanvas();
    expect(canvas).toBeTruthy();
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: 'Chrome Linux', gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    configure.mockClear();
    expect(manager.initExportCanvas(device, 640, 360)).toBe(false);
    expect(manager.getExportCanvas()).toBeNull();
    expect(manager.getExportCanvasContext()).toBeNull();
    expect(configure).not.toHaveBeenCalled();
  });

  it('keeps Android on the GPU canvas path', () => {
    vi.stubGlobal('navigator', { platform: 'Linux armv8', userAgent: 'Chrome Android', gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    expect(manager.initExportCanvas(device, 640, 360)).toBe(true);
  });

  it('does not capture after cleanup', async () => {
    manager.cleanupExportCanvas();
    await expect(manager.createVideoFrameFromExport(device, 0, 33)).resolves.toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
});
