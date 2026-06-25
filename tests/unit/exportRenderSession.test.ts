import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/types';
import type { ExportRenderHostPort } from '../../src/engine/export/exportRenderHostPort';

const mockFactory = vi.hoisted(() => {
  const calls: string[] = [];
  const originalDimensions = { width: 1280, height: 720 };
  const videoFrame = {
    displayWidth: 1920,
    displayHeight: 1080,
    codedWidth: 1920,
    codedHeight: 1080,
  };
  const pixels = new Uint8ClampedArray([1, 2, 3, 4]);

  const engine = {
    getOutputDimensions: vi.fn(() => {
      calls.push('getOutputDimensions');
      return originalDimensions;
    }),
    setResolution: vi.fn((width: number, height: number) => {
      calls.push(`setResolution:${width}x${height}`);
    }),
    setExporting: vi.fn((exporting: boolean) => {
      calls.push(`setExporting:${exporting}`);
    }),
    initExportCanvas: vi.fn((width: number, height: number, stackedAlpha: boolean) => {
      calls.push(`initExportCanvas:${width}x${height}:${stackedAlpha}`);
      return true;
    }),
    isDeviceValid: vi.fn(() => {
      calls.push('isDeviceValid');
      return true;
    }),
    initialize: vi.fn(async () => {
      calls.push('initialize');
      return true;
    }),
    setRenderTimeOverride: vi.fn((time: number | null) => {
      calls.push(`setRenderTimeOverride:${time}`);
    }),
    ensureExportLayersReady: vi.fn(async () => {
      calls.push('ensureExportLayersReady');
    }),
    render: vi.fn(() => {
      calls.push('render');
    }),
    createVideoFrameFromExport: vi.fn(async (timestamp: number, duration: number) => {
      calls.push(`createVideoFrameFromExport:${timestamp}:${duration}`);
      return videoFrame;
    }),
    readPixels: vi.fn(async () => {
      calls.push('readPixels');
      return pixels;
    }),
    cleanupExportCanvas: vi.fn(() => {
      calls.push('cleanupExportCanvas');
    }),
    requestNewFrameRender: vi.fn(() => {
      calls.push('requestNewFrameRender');
    }),
  };

  const syncExportMaskTextures = vi.fn(() => {
    calls.push('syncExportMaskTextures');
  });

  return {
    calls,
    engine,
    originalDimensions,
    pixels,
    syncExportMaskTextures,
    videoFrame,
  };
});

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: mockFactory.engine,
}));

vi.mock('../../src/engine/export/ExportMaskTextures', () => ({
  syncExportMaskTextures: mockFactory.syncExportMaskTextures,
}));

import {
  ExportFrameCaptureUnavailableError,
  ExportRenderSessionImpl,
} from '../../src/engine/export/ExportRenderSessionImpl';

const layers = [{ id: 'layer-a' }] as unknown as Layer[];

function createSession(preferZeroCopy = true): ExportRenderSessionImpl {
  return new ExportRenderSessionImpl({
    runId: 'export-run-a',
    width: 1920,
    height: 1080,
    stackedAlpha: true,
    preferZeroCopy,
  });
}

function createInjectedHost(): ExportRenderHostPort {
  return {
    getTelemetry: vi.fn(() => ({
      mode: 'main',
      presentationStrategy: 'main-host-fallback',
      lifecycleOwner: 'exportRenderHostPort',
    })),
    ensureReady: vi.fn(async () => true),
    getOutputDimensions: vi.fn(() => ({ width: 640, height: 360 })),
    setResolution: vi.fn(),
    setExporting: vi.fn(),
    initExportCanvas: vi.fn(() => false),
    isDeviceValid: vi.fn(() => true),
    setRenderTimeOverride: vi.fn(),
    ensureExportLayersReady: vi.fn(async () => undefined),
    render: vi.fn(),
    createVideoFrameFromExport: vi.fn(async () => null),
    readPixels: vi.fn(async () => new Uint8ClampedArray([5, 6, 7, 8])),
    cleanupExportCanvas: vi.fn(),
    hasMaskTexture: vi.fn(() => false),
    updateMaskTexture: vi.fn(),
    removeMaskTexture: vi.fn(),
    ensureGaussianSplatSceneLoaded: vi.fn(async () => true),
    ensureSceneRendererInitialized: vi.fn(async () => true),
    preloadSceneModelAsset: vi.fn(async () => true),
  };
}

beforeEach(() => {
  mockFactory.calls.length = 0;
  vi.clearAllMocks();
});

describe('ExportRenderSessionImpl', () => {
  it('begins with the original export setup order', async () => {
    const session = createSession();

    await session.begin();

    expect(session.usesZeroCopy).toBe(true);
    expect(mockFactory.calls).toEqual([
      'isDeviceValid',
      'getOutputDimensions',
      'setResolution:1920x1080',
      'setExporting:true',
      'initExportCanvas:1920x1080:true',
    ]);
  });

  it('renders and captures a zero-copy frame in the original order', async () => {
    const session = createSession();
    await session.begin();
    mockFactory.calls.length = 0;

    const capture = await session.renderFrame({
      time: 1.25,
      layers,
      timestampMicros: 123000,
      durationMicros: 42000,
    });

    expect(capture.kind).toBe('video-frame');
    expect(capture.width).toBe(1920);
    expect(capture.height).toBe(1080);
    expect(mockFactory.syncExportMaskTextures).toHaveBeenCalledWith(
      layers,
      1920,
      1080,
      1.25,
      expect.objectContaining({
        getOutputDimensions: expect.any(Function),
      }),
    );
    expect(mockFactory.calls).toEqual([
      'isDeviceValid',
      'setRenderTimeOverride:1.25',
      'ensureExportLayersReady',
      'syncExportMaskTextures',
      'render',
      'createVideoFrameFromExport:123000:42000',
    ]);
  });

  it('renders and captures a readback frame in the original order', async () => {
    const session = createSession(false);
    await session.begin();
    mockFactory.calls.length = 0;

    const capture = await session.renderFrame({
      time: 2,
      layers,
      timestampMicros: 200000,
      durationMicros: 33333,
    });

    expect(capture.kind).toBe('rgba-pixels');
    expect(capture.width).toBe(1920);
    expect(capture.height).toBe(1080);
    expect(mockFactory.calls).toEqual([
      'isDeviceValid',
      'setRenderTimeOverride:2',
      'ensureExportLayersReady',
      'syncExportMaskTextures',
      'render',
      'readPixels',
    ]);
  });

  it('passes an injected export host into mask texture sync', async () => {
    const host = createInjectedHost();
    const session = new ExportRenderSessionImpl({
      runId: 'export-run-host',
      width: 320,
      height: 180,
      stackedAlpha: false,
      preferZeroCopy: false,
      host,
    });
    await session.begin();

    await session.renderFrame({
      time: 5,
      layers,
      timestampMicros: 500000,
      durationMicros: 33333,
    });

    expect(mockFactory.syncExportMaskTextures).toHaveBeenCalledWith(layers, 320, 180, 5, host);
  });

  it('retries a deferred nested composition render before capture', async () => {
    const host = createInjectedHost();
    vi.mocked(host.render)
      .mockImplementationOnce(() => {
        throw new Error('Export frame deferred because a nested composition was not ready');
      })
      .mockImplementationOnce(() => undefined);
    const session = new ExportRenderSessionImpl({
      runId: 'export-run-nested-retry',
      width: 320,
      height: 180,
      stackedAlpha: false,
      preferZeroCopy: false,
      host,
    });
    await session.begin();

    const capture = await session.renderFrame({
      time: 5,
      layers,
      timestampMicros: 500000,
      durationMicros: 33333,
    });

    expect(capture.kind).toBe('rgba-pixels');
    expect(host.render).toHaveBeenCalledTimes(2);
    expect(host.ensureExportLayersReady).toHaveBeenCalledTimes(2);
    expect(host.readPixels).toHaveBeenCalledTimes(1);
  });

  it('revalidates the export host once before rendering a frame', async () => {
    let valid = false;
    const host = createInjectedHost();
    vi.mocked(host.isDeviceValid).mockImplementation(() => valid);
    vi.mocked(host.ensureReady).mockImplementation(async () => {
      valid = true;
      return true;
    });
    const session = new ExportRenderSessionImpl({
      runId: 'export-run-recover',
      width: 320,
      height: 180,
      stackedAlpha: false,
      preferZeroCopy: false,
      host,
    });
    await session.begin();
    valid = false;
    vi.mocked(host.ensureReady).mockClear();

    const capture = await session.renderFrame({
      time: 2,
      layers,
      timestampMicros: 200000,
      durationMicros: 33333,
    });

    expect(capture.kind).toBe('rgba-pixels');
    expect(host.ensureReady).toHaveBeenCalledTimes(1);
    expect(host.render).toHaveBeenCalledWith(layers);
  });

  it('reports the active export host when frame render cannot recover', async () => {
    const host = createInjectedHost();
    vi.mocked(host.getTelemetry).mockReturnValue({
      mode: 'worker-software',
      presentationStrategy: 'worker-software-readback',
      lifecycleOwner: 'exportRenderHostPort',
    });
    vi.mocked(host.isDeviceValid).mockReturnValue(false);
    vi.mocked(host.ensureReady).mockResolvedValueOnce(true);
    const session = new ExportRenderSessionImpl({
      runId: 'export-run-invalid',
      width: 320,
      height: 180,
      stackedAlpha: false,
      preferZeroCopy: false,
      host,
    });
    await session.begin();
    vi.mocked(host.ensureReady).mockReset();
    vi.mocked(host.ensureReady).mockResolvedValue(false);

    await expect(session.renderFrame({
      time: 2,
      layers,
      timestampMicros: 200000,
      durationMicros: 33333,
    })).rejects.toThrow('worker-software/worker-software-readback');
    expect(host.render).not.toHaveBeenCalled();
  });

  it('falls back to readback when zero-copy VideoFrame capture is unavailable', async () => {
    const session = createSession();
    await session.begin();
    mockFactory.calls.length = 0;
    mockFactory.engine.createVideoFrameFromExport.mockImplementationOnce(async (timestamp: number, duration: number) => {
      mockFactory.calls.push(`createVideoFrameFromExport:${timestamp}:${duration}`);
      return null;
    });

    const capture = await session.renderFrame({
      time: 3,
      layers,
      timestampMicros: 300000,
      durationMicros: 33333,
    });

    expect(capture.kind).toBe('rgba-pixels');
    expect(capture.width).toBe(1920);
    expect(capture.height).toBe(1080);
    expect(mockFactory.calls).toEqual([
      'isDeviceValid',
      'setRenderTimeOverride:3',
      'ensureExportLayersReady',
      'syncExportMaskTextures',
      'render',
      'createVideoFrameFromExport:300000:33333',
      'isDeviceValid',
      'readPixels',
    ]);
  });

  it('throws when both zero-copy and readback capture are unavailable', async () => {
    const session = createSession();
    await session.begin();
    mockFactory.calls.length = 0;
    mockFactory.engine.createVideoFrameFromExport.mockResolvedValueOnce(null);
    mockFactory.engine.readPixels.mockResolvedValueOnce(null);

    await expect(session.renderFrame({
      time: 4,
      layers,
      timestampMicros: 400000,
      durationMicros: 33333,
    })).rejects.toBeInstanceOf(ExportFrameCaptureUnavailableError);
  });

  it('disposes with the original restore order and is idempotent', async () => {
    const session = createSession();
    await session.begin();
    mockFactory.calls.length = 0;

    session.dispose();
    session.dispose();

    expect(mockFactory.calls).toEqual([
      'setRenderTimeOverride:null',
      'cleanupExportCanvas',
      'setExporting:false',
      'setResolution:1280x720',
      'requestNewFrameRender',
    ]);
  });

  it('cancels by aborting the signal and restoring the engine state', async () => {
    const session = createSession();
    await session.begin();
    mockFactory.calls.length = 0;

    session.cancel('stop-export');

    expect(session.signal.aborted).toBe(true);
    expect(session.signal.reason).toBe('stop-export');
    expect(mockFactory.calls).toEqual([
      'setRenderTimeOverride:null',
      'cleanupExportCanvas',
      'setExporting:false',
      'setResolution:1280x720',
      'requestNewFrameRender',
    ]);
  });
});
