import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import { useRenderTargetStore } from '../../src/stores/renderTargetStore';
import { flags } from '../../src/engine/featureFlags';
import type { RenderHostPort } from '../../src/services/render/renderHostTypes';
import { createWorkerPresentingRenderHostPort } from '../../src/services/render/workerPresentingRenderHostPort';
import type { WorkerRenderHostRuntimeBridge } from '../../src/services/render/workerRenderHostRuntimeBridge';
import type { WorkerRenderHostRuntimeJobOutput } from '../../src/services/render/workerRenderHostRuntimeHandlers';

vi.mock('../../src/utils/canvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: () => false,
}));

const originalWorker = globalThis.Worker;
const originalTransfer = HTMLCanvasElement.prototype.transferControlToOffscreen;

function createFallback(): RenderHostPort {
  return {
    getTelemetry: vi.fn(),
    getCaptureCanvas: vi.fn(() => null),
    getOutputDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
    initialize: vi.fn().mockResolvedValue(true),
    registerTargetCanvas: vi.fn(() => ({ label: 'fallback-context' }) as unknown as GPUCanvasContext),
    unregisterTargetCanvas: vi.fn(),
    render: vi.fn(),
    renderCachedFrame: vi.fn(() => false),
    cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    getRamPreviewRenderEngine: vi.fn(() => ({
      render: vi.fn(),
      cacheCompositeFrame: vi.fn().mockResolvedValue(undefined),
    })),
    clearCompositeCache: vi.fn(),
    getCompositeCacheStats: vi.fn(() => ({ count: 0, maxFrames: 0, memoryMB: 0 })),
    setGeneratingRamPreview: vi.fn(),
    renderToPreviewCanvas: vi.fn(),
    requestRender: vi.fn(),
    requestNewFrameRender: vi.fn(),
    preCacheVideoFrame: vi.fn().mockResolvedValue(true),
    ensureVideoFrameCached: vi.fn(),
    cacheFrameAtTime: vi.fn(),
    captureVideoFrameAtTime: vi.fn(() => true),
    markVideoFramePresented: vi.fn(),
    getLastPresentedVideoTime: vi.fn(() => undefined),
    markVideoGpuReady: vi.fn(),
    cleanupVideo: vi.fn(),
  } as unknown as RenderHostPort;
}

function output(overrides: Partial<WorkerRenderHostRuntimeJobOutput> = {}): WorkerRenderHostRuntimeJobOutput {
  return {
    accepted: true,
    commandType: 'RenderNow',
    initialized: true,
    rendererId: 'worker-presenting-render-host',
    strategy: 'worker-cpu-present',
    targetIds: ['preview'],
    scheduler: {
      queueDepth: 0,
      byPriority: { critical: 0, high: 0, normal: 0, low: 0, idle: 0 },
      byType: {
        'live-playback': 0,
        scrub: 0,
        'independent-preview': 0,
        'ram-preview': 0,
        thumbnail: 0,
        'clip-bake': 0,
        'composition-bake': 0,
        export: 0,
      },
      oldestCommandAgeMs: 0,
      counters: {
        admitted: 1,
        enqueued: 1,
        started: 1,
        completed: 1,
        canceled: 0,
        coalesced: 0,
        dropped: 0,
        expired: 0,
        late: 0,
        staleResponses: 0,
        resizeCoalesced: 0,
        priorityInversions: 0,
      },
    },
    cache: {
      entries: 2,
      bytes: 1024,
      bytesByOwner: {
        'source-frame': 0,
        'hold-frame': 0,
        'composite-frame': 0,
        'subcomp-output': 0,
        'mask-texture': 0,
        'effect-plan': 0,
        'target-surface': 1024,
        'bake-artifact': 0,
        thumbnail: 0,
        'export-frame': 0,
      },
      counters: {
        allocations: 2,
        reuses: 1,
        evictions: 0,
        transfers: 1,
        releases: 0,
        leakChecks: 0,
      },
    },
    statusEvents: [],
    transferLatencyMs: 4,
    providerWaitMs: null,
    presentedFrameId: 'preview:render-1:1',
    readback: null,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createBridge() {
  return {
    initialize: vi.fn().mockResolvedValue(output({ commandType: 'initialize', presentedFrameId: null })),
    registerTarget: vi.fn().mockResolvedValue(output({ commandType: 'registerTarget', presentedFrameId: null })),
    attachTargetSurface: vi.fn().mockResolvedValue(output({ commandType: 'attachTargetSurface', presentedFrameId: null })),
    detachTargetSurface: vi.fn().mockResolvedValue(output({ commandType: 'detachTargetSurface', presentedFrameId: null })),
    renderNow: vi.fn().mockResolvedValue(output({ commandType: 'RenderNow' })),
    presentSoftwareFrame: vi.fn().mockResolvedValue(output({
      commandType: 'presentSoftwareFrame',
      statusEvents: [{
        type: 'frame-presented',
        requestId: 'render-1',
        targetId: 'preview',
        timelineTime: 0,
      }],
    })),
    presentGpuTestPattern: vi.fn().mockResolvedValue(output({
      commandType: 'gpu.presentTestPattern',
      statusEvents: [{
        type: 'frame-presented',
        requestId: 'gpu-render-1',
        targetId: 'preview',
        timelineTime: 0,
      }],
      presentedFrameId: 'preview:gpu-render-1:gpu-clear:1',
    })),
    presentGpuTransferredVideoFrames: vi.fn((
      requestId: string,
      targetId: string,
      timelineTime: number,
      sequence: number,
    ) => Promise.resolve(output({
      commandType: 'presentGpuTransferredVideoFrames',
      statusEvents: [
        {
          type: 'frame-presented',
          requestId,
          targetId,
          timelineTime,
        },
        {
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.presented': true,
            'workerGpu.videoFrame.sourceReady': true,
            'workerGpu.videoFrame.timestampSeconds': timelineTime,
            'workerGpu.videoFrame.targetMediaTime': timelineTime,
            'workerGpu.videoFrame.mode': 'html-transfer',
            'workerGpu.videoFrame.decoder': 'HTMLVideo',
            'workerGpu.videoFrame.streaming': false,
          },
        },
      ],
      presentedFrameId: `${targetId}:${requestId}:gpu-html-video:${sequence}`,
    }))),
    loadWebCodecsSource: vi.fn((requestId: string, sourceId: string) => Promise.resolve(output({
      commandType: 'loadWebCodecsSource',
      presentedFrameId: null,
      statusEvents: [{
        type: 'command-accepted',
        commandType: 'loadWebCodecsSource',
        requestId,
        presentation: 'not-presenting',
      }],
      webCodecs: {
        status: {
          sourceId,
          ready: true,
          width: 1920,
          height: 1080,
          frameRate: 60,
          currentTime: 0,
          hasFrame: true,
          pendingSeekTime: null,
          decodePending: false,
        },
        frame: null,
      },
    }))),
    presentGpuWebCodecsFrame: vi.fn((
      requestId: string,
      targetId: string,
      sourceId: string,
      timelineTime: number,
      mediaTime: number,
      sequence: number,
      options?: { mode?: string },
    ) => Promise.resolve(output({
      commandType: 'gpu.presentWebCodecsFrame',
      statusEvents: [
        {
          type: 'frame-presented',
          requestId,
          targetId,
          timelineTime,
        },
        {
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.presented': true,
            'workerGpu.videoFrame.sourceReady': true,
            'workerGpu.videoFrame.sourceFrameRate': 60,
            'workerGpu.videoFrame.timestampSeconds': mediaTime,
            'workerGpu.videoFrame.targetMediaTime': mediaTime,
            'workerGpu.videoFrame.mode': options?.mode ?? 'seek',
            'workerGpu.videoFrame.streaming': false,
          },
        },
      ],
      presentedFrameId: `${targetId}:${requestId}:gpu-video:${sequence}`,
      webCodecs: {
        status: {
          sourceId,
          ready: true,
          width: 1920,
          height: 1080,
          frameRate: 60,
          currentTime: mediaTime,
          hasFrame: true,
          pendingSeekTime: null,
          decodePending: false,
        },
        frame: null,
      },
    }))),
    startGpuWebCodecsStream: vi.fn((
      requestId: string,
      targetId: string,
      sourceId: string,
      timelineTime: number,
      mediaTime: number,
      sequence: number,
    ) => Promise.resolve(output({
      commandType: 'gpu.startWebCodecsStream',
      statusEvents: [
        {
          type: 'frame-presented',
          requestId,
          targetId,
          timelineTime,
        },
        {
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.presented': true,
            'workerGpu.videoFrame.sourceReady': true,
            'workerGpu.videoFrame.sourceFrameRate': 60,
            'workerGpu.videoFrame.timestampSeconds': mediaTime,
            'workerGpu.videoFrame.targetMediaTime': mediaTime,
            'workerGpu.videoFrame.mode': 'stream',
            'workerGpu.videoFrame.streaming': true,
            'workerGpu.videoFrame.workerStream.active': true,
            'workerGpu.videoFrame.workerStream.targetId': targetId,
            'workerGpu.videoFrame.workerStream.sourceId': sourceId,
            'workerGpu.videoFrame.workerStream.presentedFrameCount': 1,
            'workerGpu.videoFrame.workerStream.distinctFrameCount': 1,
            'workerGpu.videoFrame.workerStream.repeatedFrameCount': 0,
            'workerGpu.videoFrame.workerStream.failureCount': 0,
          },
        },
      ],
      presentedFrameId: `${targetId}:${requestId}:gpu-video-stream:${sequence}`,
    }))),
    stopGpuWebCodecsStream: vi.fn((requestId: string, targetId: string, options?: { readonly sourceId?: string }) => (
      Promise.resolve(output({
        commandType: 'gpu.stopWebCodecsStream',
        presentedFrameId: null,
        statusEvents: [{
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.workerStream.active': false,
            'workerGpu.videoFrame.workerStream.targetId': targetId,
            'workerGpu.videoFrame.workerStream.sourceId': options?.sourceId ?? null,
            'workerGpu.videoFrame.workerStream.presentedFrameCount': 1,
            'workerGpu.videoFrame.workerStream.distinctFrameCount': 1,
            'workerGpu.videoFrame.workerStream.repeatedFrameCount': 0,
            'workerGpu.videoFrame.workerStream.failureCount': 0,
            'workerGpu.videoFrame.mode': 'stream',
            'workerGpu.videoFrame.streaming': false,
          },
        }],
      }))
    )),
    collectStats: vi.fn((requestId: string) => Promise.resolve(output({
      commandType: 'collectStats',
      requestId,
      presentedFrameId: null,
    }))),
    sendCommand: vi.fn().mockResolvedValue(output({ commandType: 'unregisterTarget', presentedFrameId: null })),
    dispose: vi.fn(),
  } as unknown as WorkerRenderHostRuntimeBridge;
}

function installAnimationFrameQueue() {
  const originalRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const originalCancelRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    }),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: vi.fn((id: number) => {
      rafCallbacks.delete(id);
    }),
  });

  return {
    flushNextFrame() {
      const first = rafCallbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!first) return false;
      const [id, callback] = first;
      rafCallbacks.delete(id);
      callback(performance.now());
      return true;
    },
    flushFrames(limit = 4) {
      let count = 0;
      while (count < limit) {
        const first = rafCallbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
        if (!first) break;
        const [id, callback] = first;
        rafCallbacks.delete(id);
        callback(performance.now());
        count += 1;
      }
      return count;
    },
    restore() {
      if (originalRafDescriptor) {
        Object.defineProperty(globalThis, 'requestAnimationFrame', originalRafDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      }
      if (originalCancelRafDescriptor) {
        Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancelRafDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
      }
    },
  };
}

function installWorkerCanvasSupport(offscreen: OffscreenCanvas): void {
  (globalThis as typeof globalThis & { Worker?: typeof Worker }).Worker = vi.fn() as unknown as typeof Worker;
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
    configurable: true,
    value: vi.fn(() => offscreen),
  });
}

function createVideo(overrides: {
  readonly currentTime: number;
  readonly seeking?: boolean;
  readonly readyState?: number;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
}): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: overrides.currentTime },
    readyState: { configurable: true, value: overrides.readyState ?? HTMLMediaElement.HAVE_CURRENT_DATA },
    seeking: { configurable: true, value: overrides.seeking ?? false },
    videoHeight: { configurable: true, value: overrides.videoHeight ?? 720 },
    videoWidth: { configurable: true, value: overrides.videoWidth ?? 1280 },
  });
  return video;
}

function createMutableVideo(state: {
  currentTime: number;
  seeking: boolean;
  readyState?: number;
}): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => state.currentTime },
    readyState: { configurable: true, get: () => state.readyState ?? HTMLMediaElement.HAVE_CURRENT_DATA },
    seeking: { configurable: true, get: () => state.seeking },
    videoHeight: { configurable: true, get: () => 720 },
    videoWidth: { configurable: true, get: () => 1280 },
  });
  return video;
}

function restoreCreateImageBitmap(originalCreateImageBitmap: typeof globalThis.createImageBitmap | undefined): void {
  if (originalCreateImageBitmap) {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: originalCreateImageBitmap,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
}

function restoreImageData(originalImageData: typeof globalThis.ImageData | undefined): void {
  if (originalImageData) {
    Object.defineProperty(globalThis, 'ImageData', {
      configurable: true,
      value: originalImageData,
    });
  } else {
    Reflect.deleteProperty(globalThis, 'ImageData');
  }
}

function expectPreviewBitmapResize(
  source: ImageBitmapSource,
  width = 640,
  height = 360,
  resizeQuality: ResizeQuality = 'high',
): void {
  expect(globalThis.createImageBitmap).toHaveBeenCalledWith(source, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality,
  });
}

describe('worker presenting render host port', () => {
  const originalUseFullWebCodecsPlayback = flags.useFullWebCodecsPlayback;
  const originalDisableHtmlPreviewFallback = flags.disableHtmlPreviewFallback;

  beforeEach(() => {
    flags.useFullWebCodecsPlayback = true;
    flags.disableHtmlPreviewFallback = true;
    clearWorkerFirstCounterSourcesForTests();
    useRenderTargetStore.setState({ targets: new Map(), selectedTargetId: null });
  });

  afterEach(() => {
    clearWorkerFirstCounterSourcesForTests();
    flags.useFullWebCodecsPlayback = originalUseFullWebCodecsPlayback;
    flags.disableHtmlPreviewFallback = originalDisableHtmlPreviewFallback;
    useRenderTargetStore.setState({ targets: new Map(), selectedTargetId: null });
    if (originalWorker) {
      (globalThis as typeof globalThis & { Worker?: typeof Worker }).Worker = originalWorker;
    } else {
      Reflect.deleteProperty(globalThis, 'Worker');
    }
    if (originalTransfer) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
        configurable: true,
        value: originalTransfer,
      });
    } else {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen');
    }
  });

  it('reports worker-presenting telemetry', () => {
    const host = createWorkerPresentingRenderHostPort({
      fallback: createFallback(),
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
    });

    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-presenting',
      presentationStrategy: 'worker-cpu-present',
      selection: { selectedId: 'worker-primary' },
    });
  });

  it('uses a 30fps drop baseline while worker-presenting scrub is active', () => {
    const host = createWorkerPresentingRenderHostPort({
      fallback: createFallback(),
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
    });
    const tickHost = host as unknown as { recordRenderLoopTick(durationMs: number): void };
    const nowSpy = vi.spyOn(performance, 'now');
    let now = 1;
    nowSpy.mockImplementation(() => now);

    try {
      host.setIsScrubbing(true);
      tickHost.recordRenderLoopTick(1);
      for (let frame = 1; frame <= 30; frame += 1) {
        now = 1 + frame * (1000 / 30);
        tickHost.recordRenderLoopTick(1);
      }

      expect(host.getStats()).toMatchObject({
        fps: 30,
        targetFps: 30,
        drops: {
          lastSecond: 0,
          reason: 'none',
        },
      });

      host.setIsScrubbing(false);
      host.setIsPlaying(true);
      tickHost.recordRenderLoopTick(1);
      for (let frame = 1; frame < 45; frame += 1) {
        now = 1001 + frame * (1000 / 45);
        tickHost.recordRenderLoopTick(1);
      }
      now = 2002;
      tickHost.recordRenderLoopTick(1);

      expect(host.getStats()).toMatchObject({
        fps: 45,
        targetFps: 60,
        drops: {
          lastSecond: 15,
          reason: 'slow_render',
        },
      });
      host.setIsPlaying(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('lets the worker-presenting render loop idle on a static visible frame', () => {
    const fallback = createFallback();
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
    });
    const originalRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const originalCancelRafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const id = nextRafId++;
        rafCallbacks.set(id, callback);
        return id;
      }),
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((id: number) => {
        rafCallbacks.delete(id);
      }),
    });
    const flushNextFrame = () => {
      const first = rafCallbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!first) return false;
      const [id, callback] = first;
      rafCallbacks.delete(id);
      callback(performance.now());
      return true;
    };
    const renderFrame = vi.fn(() => {
      host.setTimelineVisualDemand(true);
    });

    try {
      host.startRenderLoop(renderFrame);

      expect(flushNextFrame()).toBe(true);
      expect(flushNextFrame()).toBe(true);
      expect(flushNextFrame()).toBe(false);
      expect(renderFrame).toHaveBeenCalledTimes(2);
      expect(host.getStats()).toMatchObject({
        fps: 0,
        isIdle: true,
      });
      expect(host.getTelemetry().diagnostics).toMatchObject({
        renderRequested: false,
        renderLoopActive: true,
        timelineVisualDemand: true,
      });
    } finally {
      host.stopRenderLoopForDiagnostics();
      if (originalRafDescriptor) {
        Object.defineProperty(globalThis, 'requestAnimationFrame', originalRafDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      }
      if (originalCancelRafDescriptor) {
        Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancelRafDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
      }
    }
  });

  it('transfers preview canvas ownership to the worker runtime and renders without fallback presentation', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    document.body.appendChild(canvas);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      left: 0,
      right: 640,
      bottom: 360,
      toJSON: () => ({}),
    } as DOMRect);

    await expect(host.initialize()).resolves.toBe(true);
    const context = host.registerTargetCanvas('preview', canvas);
    host.render([{
      id: 'solid-a',
      name: 'Solid A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'solid', color: '#ff0000' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    expect(context).toMatchObject({
      __workerRenderHostContext: true,
      targetId: 'preview',
      canvas,
    });
    expect(fallback.initialize).not.toHaveBeenCalled();
    expect(fallback.registerTargetCanvas).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(bridge.initialize).toHaveBeenCalledWith('worker-presenting-render-host', 'worker-cpu-present');
      expect(bridge.registerTarget).toHaveBeenCalledWith(expect.objectContaining({
        id: 'preview',
        size: { x: 640, y: 360 },
        presentation: 'offscreen-canvas',
      }));
      expect(bridge.attachTargetSurface).toHaveBeenCalledWith({
        targetId: 'preview',
        canvas: offscreen,
        presentation: 'offscreen-canvas',
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          size: { x: 640, y: 360 },
          layers: [expect.objectContaining({
            id: 'solid-a',
            geometry: {
              position: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              rotation: 0,
              sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            source: { kind: 'solid', color: '#ff0000' },
          })],
        }),
        [],
      );
    });
    await vi.waitFor(() => {
      expect(getWorkerFirstCounterSourceSnapshot().presentedFrameId).toBe('preview:render-1:1');
    });
    expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
      expect.objectContaining({
        frameId: 'preview:render-1:1',
        targetId: 'preview',
        source: 'worker-presenting:none',
        changed: true,
      }),
    ]);
  });

  it('records presented frame telemetry even when the worker omits status events', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    bridge.presentSoftwareFrame = vi.fn().mockResolvedValue(output({
      commandType: 'presentSoftwareFrame',
      statusEvents: [],
      presentedFrameId: 'preview:render-no-status:1',
    }));
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'test',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);

    host.render([{
      id: 'solid-a',
      name: 'Solid',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'solid', color: '#ff0000' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(getWorkerFirstCounterSourceSnapshot().presentedFrameId).toBe('preview:render-no-status:1');
    });
    expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
      expect.objectContaining({
        frameId: 'preview:render-no-status:1',
        targetId: 'preview',
        source: 'worker-presenting:none',
      }),
    ]);
  });

  it('marks the preview target as moved when scrub media time changes', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const bitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    installWorkerCanvasSupport(offscreen);
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const video = createVideo({ currentTime: 1 });
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);

    const renderAt = (mediaTime: number) => host.render([{
      id: 'video-a',
      name: 'Video A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'video', videoElement: video, mediaTime },
      sourceClipId: 'clip-a',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    try {
      renderAt(1);
      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      renderAt(1.5);
      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
      });

      expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
        expect.objectContaining({
          changed: true,
          targetMoved: false,
        }),
        expect.objectContaining({
          changed: true,
          targetMoved: true,
        }),
      ]);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('records presented frame source from the packet diagnostics instead of later target diagnostics', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const bitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    let resolvePreview: ((value: WorkerRenderHostRuntimeJobOutput) => void) | null = null;
    installWorkerCanvasSupport(offscreen);
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    bridge.presentSoftwareFrame = vi.fn(async (
      requestId: string,
      targetId: string,
      timelineTime: number,
    ) => {
      if (targetId === 'preview') {
        return new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
          resolvePreview = resolve;
        });
      }
      return output({
        commandType: 'presentSoftwareFrame',
        presentedFrameId: `${targetId}:${requestId}:1`,
        statusEvents: [{
          type: 'frame-presented',
          requestId,
          targetId,
          timelineTime,
        }],
      });
    });
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'test',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
    });
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 640;
    previewCanvas.height = 360;
    const secondaryCanvas = document.createElement('canvas');
    secondaryCanvas.width = 640;
    secondaryCanvas.height = 360;
    const htmlVideo = createVideo({ currentTime: 1 });
    const webCodecsFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;

    try {
      host.registerTargetCanvas('preview', previewCanvas);
      host.registerTargetCanvas('secondary-preview', secondaryCanvas);
      host.render([{
        id: 'wc-video',
        name: 'WC Video',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoFrame: webCodecsFrame, mediaTime: 1 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);
      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
          expect.stringContaining('worker-presenting:render'),
          'preview',
          0,
          expect.anything(),
          expect.anything(),
        );
        expect(resolvePreview).toBeTypeOf('function');
      });

      host.renderToPreviewCanvas('secondary-preview', [{
        id: 'html-video',
        name: 'HTML Video',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: htmlVideo, mediaTime: 1 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);
      await vi.waitFor(() => {
        expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
          expect.objectContaining({
            targetId: 'secondary-preview',
            source: 'worker-only:HTMLVideo',
          }),
        ]);
      });

      resolvePreview?.(output({
        commandType: 'presentSoftwareFrame',
        presentedFrameId: 'preview:render-wc:1',
        statusEvents: [{
          type: 'frame-presented',
          requestId: 'render-wc',
          targetId: 'preview',
          timelineTime: 0,
        }],
      }));
      await vi.waitFor(() => {
        expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
          expect.objectContaining({
            targetId: 'secondary-preview',
            source: 'worker-only:HTMLVideo',
          }),
          expect.objectContaining({
            frameId: 'preview:render-wc:1',
            targetId: 'preview',
            source: 'worker-only:WebCodecs',
          }),
        ]);
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('routes active composition renders to the registered active preview target when no legacy preview target exists', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    await expect(host.initialize()).resolves.toBe(true);
    const context = host.registerTargetCanvas('preview-panel-main', canvas);
    useRenderTargetStore.setState({
      targets: new Map([[
        'preview-panel-main',
        {
          id: 'preview-panel-main',
          name: 'Preview',
          source: { type: 'activeComp' },
          destinationType: 'canvas',
          enabled: true,
          showTransparencyGrid: false,
          canvas,
          context,
          window: null,
          isFullscreen: false,
        },
      ]]),
      selectedTargetId: null,
    });

    host.render([{
      id: 'solid-active',
      name: 'Solid Active',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'solid', color: '#00ff00' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview-panel-main',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'solid-active',
            source: { kind: 'solid', color: '#00ff00' },
          })],
        }),
        [],
      );
    });
    expect(bridge.renderNow).not.toHaveBeenCalled();
    expect(fallback.render).not.toHaveBeenCalled();
  });

  it('caches and re-presents RAM preview frames in worker-only without main fallback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const originalImageData = globalThis.ImageData;
    const cachedBitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    installWorkerCanvasSupport(offscreen);
    Object.defineProperty(globalThis, 'ImageData', {
      configurable: true,
      value: class TestImageData {
        data: Uint8ClampedArray;
        width: number;
        height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(async () => cachedBitmap),
    });
    bridge.presentSoftwareFrame = vi.fn(async (
      requestId: string,
      targetId: string,
      timelineTime: number,
      _frame,
      _transfer,
      options?: { readonly readback?: boolean },
    ) => output({
      commandType: 'presentSoftwareFrame',
      presentedFrameId: `${targetId}:${requestId}:1`,
      statusEvents: [{
        type: 'frame-presented',
        requestId,
        targetId,
        timelineTime,
      }],
      readback: options?.readback
        ? {
            width: 640,
            height: 360,
            pixels: new Uint8ClampedArray(640 * 360 * 4).fill(255),
          }
        : null,
    }));
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    try {
      await expect(host.initialize()).resolves.toBe(true);
      host.registerTargetCanvas('preview', canvas);
      const ramPreviewEngine = host.getRamPreviewRenderEngine();
      ramPreviewEngine.render([{
        id: 'solid-cache',
        name: 'Solid Cache',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'solid', color: '#112233' },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);
      await ramPreviewEngine.cacheCompositeFrame(1);

      expect(host.getCompositeCacheStats()).toMatchObject({
        count: 1,
        maxFrames: 900,
      });
      expect(fallback.getRamPreviewRenderEngine).not.toHaveBeenCalled();
      expect(fallback.render).not.toHaveBeenCalled();
      expect(fallback.cacheCompositeFrame).not.toHaveBeenCalled();
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:cache-composite'),
        'preview',
        1,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'solid-cache',
          })],
        }),
        [],
        { readback: true },
      );

      expect(host.renderCachedFrame(1)).toBe(true);
      await vi.waitFor(() => {
        expect(globalThis.createImageBitmap).toHaveBeenCalled();
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
          expect.stringContaining('worker-presenting:cached-composite'),
          'preview',
          1,
          expect.objectContaining({
            layers: [expect.objectContaining({
              source: expect.objectContaining({ kind: 'bitmap' }),
            })],
          }),
          [cachedBitmap],
        );
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
      restoreImageData(originalImageData);
    }
  });

  it('holds the last worker frame when a later scrub snapshot has no presentable layers', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);

    host.render([{
      id: 'solid-a',
      name: 'Solid A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'solid', color: '#ff0000' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);
    await vi.waitFor(() => {
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    });

    host.render([{
      id: 'unsupported-video-a',
      name: 'Unsupported Video A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'video' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(host.getTelemetry().diagnostics).toMatchObject({
        holdingLastSoftwareFrame: true,
        heldEmptySoftwareFrameCount: 1,
        lastSoftwareFrame: {
          sourceLayerCount: 1,
          presentableLayerCount: 1,
          skippedLayerCount: 0,
        },
        lastAttemptedSoftwareFrame: {
          sourceLayerCount: 1,
          presentableLayerCount: 0,
          skippedLayerCount: 1,
        },
      });
    });
    expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
  });

  it('presents partial worker frames when a later packet has presentable layers plus unsupported layers', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);

    const baseLayer = {
      id: 'solid-a',
      name: 'Solid A',
      visible: true,
      opacity: 1,
      blendMode: 'normal' as const,
      source: { type: 'solid' as const, color: '#ff0000' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    host.render([baseLayer]);
    await vi.waitFor(() => {
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
    });

    host.render([
      baseLayer,
      {
        ...baseLayer,
        id: 'solid-effect',
        name: 'Solid Effect',
        effects: [{
          id: 'effect-a',
          type: 'voxel-relief',
          name: 'Voxel Relief',
          enabled: true,
          params: {},
        }],
      },
    ]);

    await vi.waitFor(() => {
      expect(host.getTelemetry().diagnostics).toMatchObject({
        holdingLastSoftwareFrame: false,
        heldEmptySoftwareFrameCount: 0,
        lastSoftwareFrame: {
          sourceLayerCount: 2,
          presentableLayerCount: 1,
          skippedLayerCount: 1,
          skippedByReason: {
            'unsupported-effects': 1,
          },
        },
      });
    });
    expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
    expect(bridge.presentSoftwareFrame).toHaveBeenLastCalledWith(
      expect.stringContaining('worker-presenting:render'),
      'preview',
      0,
      expect.objectContaining({
        layers: [expect.objectContaining({ id: 'solid-a' })],
      }),
      [],
    );
  });

  it('uses a held cached video layer when a transient scrub skip would drop one layer', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const videoA = createMutableVideo({
      currentTime: 1,
      seeking: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    const videoBState = {
      currentTime: 1,
      seeking: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    };
    const videoB = createMutableVideo(videoBState);
    const baseLayer = {
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal' as const,
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    try {
      host.render([
        {
          ...baseLayer,
          id: 'video-a',
          sourceClipId: 'clip-a',
          source: { type: 'video' as const, videoElement: videoA, mediaTime: 1 },
        },
        {
          ...baseLayer,
          id: 'video-b',
          sourceClipId: 'clip-b',
          source: { type: 'video' as const, videoElement: videoB, mediaTime: 1 },
        },
      ]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });

      videoBState.readyState = HTMLMediaElement.HAVE_NOTHING;
      host.render([
        {
          ...baseLayer,
          id: 'video-a',
          sourceClipId: 'clip-a',
          source: { type: 'video' as const, videoElement: videoA, mediaTime: 1 },
        },
        {
          ...baseLayer,
          id: 'video-b',
          sourceClipId: 'clip-b',
          source: { type: 'video' as const, videoElement: videoB, mediaTime: 5 },
        },
      ]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
      });
      expect(host.getTelemetry().diagnostics).toMatchObject({
          holdingLastSoftwareFrame: false,
          heldEmptySoftwareFrameCount: 0,
          transientSoftwareFrameRetryCount: 0,
          lastSoftwareFrame: {
            sourceLayerCount: 2,
            presentableLayerCount: 2,
            skippedLayerCount: 0,
          },
          lastAttemptedSoftwareFrame: {
            sourceLayerCount: 2,
            presentableLayerCount: 2,
            skippedLayerCount: 0,
            skippedByReason: {
              'video-not-ready': 0,
            },
          },
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: 'video-b',
              source: expect.objectContaining({ kind: 'cached-bitmap' }),
            }),
          ]),
        }),
        expect.any(Array),
      );
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('uses a held cached video layer for transient video drops just after scrub stops', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const videoA = createMutableVideo({
      currentTime: 1,
      seeking: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    const videoBState = {
      currentTime: 1,
      seeking: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    };
    const videoB = createMutableVideo(videoBState);
    const baseLayer = {
      name: 'Video',
      visible: true,
      opacity: 1,
      blendMode: 'normal' as const,
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    try {
      host.render([
        {
          ...baseLayer,
          id: 'video-a',
          sourceClipId: 'clip-a',
          source: { type: 'video' as const, videoElement: videoA, mediaTime: 1 },
        },
        {
          ...baseLayer,
          id: 'video-b',
          sourceClipId: 'clip-b',
          source: { type: 'video' as const, videoElement: videoB, mediaTime: 1 },
        },
      ]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });

      host.setIsScrubbing(false);
      videoBState.readyState = HTMLMediaElement.HAVE_NOTHING;
      host.render([
        {
          ...baseLayer,
          id: 'video-a',
          sourceClipId: 'clip-a',
          source: { type: 'video' as const, videoElement: videoA, mediaTime: 1 },
        },
        {
          ...baseLayer,
          id: 'video-b',
          sourceClipId: 'clip-b',
          source: { type: 'video' as const, videoElement: videoB, mediaTime: 5 },
        },
      ]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
      });
      expect(host.getTelemetry().diagnostics).toMatchObject({
          holdingLastSoftwareFrame: false,
          heldEmptySoftwareFrameCount: 0,
          lastSoftwareFrame: {
            sourceLayerCount: 2,
            presentableLayerCount: 2,
            skippedLayerCount: 0,
          },
          lastAttemptedSoftwareFrame: {
            sourceLayerCount: 2,
            presentableLayerCount: 2,
            skippedLayerCount: 0,
            skippedByReason: {
              'video-not-ready': 0,
            },
          },
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: expect.arrayContaining([
            expect.objectContaining({
              id: 'video-b',
              source: expect.objectContaining({ kind: 'cached-bitmap' }),
            }),
          ]),
        }),
        expect.any(Array),
      );
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('presents settled html video snapshots during scrubbing', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 4 });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 4 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video, 640, 360, 'medium');
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({ kind: 'bitmap', bitmap }),
          })],
        }),
        [bitmap],
      );
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('keeps html video snapshots presentable in worker-only without main fallback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    const video = createVideo({ currentTime: 4 });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 4 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video);
      expect(fallback.registerTargetCanvas).not.toHaveBeenCalled();
      expect(fallback.render).not.toHaveBeenCalled();
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({ kind: 'bitmap', bitmap }),
          })],
        }),
        [bitmap],
      );
      expect(host.getTelemetry()).toMatchObject({
        mode: 'worker-only',
        diagnostics: {
          strictWorkerOnly: true,
          lastSoftwareFrame: {
            sourceLayerCount: 1,
            presentableLayerCount: 1,
            skippedLayerCount: 0,
          },
        },
      });
      expect(getWorkerFirstCounterSourceSnapshot().presentedFrames).toEqual([
        expect.objectContaining({
          source: 'worker-only:HTMLVideo',
        }),
      ]);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('uses the drag drift tolerance for worker-presenting scrub snapshots', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 4.3 });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 4 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video, 640, 360, 'medium');
      expect(host.getTelemetry().diagnostics).toMatchObject({
        transientSoftwareFrameRetryCount: 0,
        lastSoftwareFrame: {
          presentableLayerCount: 1,
          skippedLayerCount: 0,
        },
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('caches seek-confirmed scrub frames but presents a live scrub snapshot', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const capturedBitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const reusedBitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(capturedBitmap)
        .mockResolvedValueOnce(reusedBitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 1.04, seeking: true });

    try {
      expect(host.captureVideoFrameAtTime(video, 1, 'clip-a')).toBe(true);
      await vi.waitFor(() => {
        expect(drawImage).toHaveBeenCalledWith(capturedBitmap, 0, 0, 256, 144);
      });

      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 1.08 },
        sourceClipId: 'clip-a',
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expect(fallback.captureVideoFrameAtTime).toHaveBeenCalledWith(video, 1, 'clip-a');
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(1, video, {
        resizeWidth: 960,
        resizeHeight: 540,
        resizeQuality: 'medium',
      });
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(2, video, {
        resizeWidth: 640,
        resizeHeight: 360,
        resizeQuality: 'medium',
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({ kind: 'bitmap', bitmap: reusedBitmap, width: 256, height: 144 }),
          })],
        }),
        [reusedBitmap],
      );
      expect(capturedBitmap.close).toHaveBeenCalled();
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('caches seek-confirmed scrub frames in strict worker-only but presents a live scrub snapshot', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const capturedBitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const reusedBitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(capturedBitmap)
        .mockResolvedValueOnce(reusedBitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 1.04, seeking: true });

    try {
      expect(host.captureVideoFrameAtTime(video, 1, 'clip-a')).toBe(false);
      host.cacheFrameAtTime(video, 1, 'clip-a');
      await vi.waitFor(() => {
        expect(drawImage).toHaveBeenCalledWith(capturedBitmap, 0, 0, 256, 144);
      });
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);

      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 1.08 },
        sourceClipId: 'clip-a',
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expect(fallback.captureVideoFrameAtTime).not.toHaveBeenCalled();
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(1, video, {
        resizeWidth: 960,
        resizeHeight: 540,
        resizeQuality: 'medium',
      });
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(2, video, {
        resizeWidth: 640,
        resizeHeight: 360,
        resizeQuality: 'medium',
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({ kind: 'bitmap', bitmap: reusedBitmap, width: 256, height: 144 }),
          })],
        }),
        [reusedBitmap],
      );
      expect(capturedBitmap.close).toHaveBeenCalled();
      expect(host.getTelemetry().mode).toBe('worker-only');
      expect((host.getTelemetry().diagnostics?.fallbackBlockedOperations as string[] | undefined) ?? [])
        .not.toContain('captureVideoFrameAtTime');
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('pre-caches cold scrub frames in strict worker-only without using the main fallback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const capturedBitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValueOnce(capturedBitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
    });
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 1.04 });

    try {
      await expect(host.preCacheVideoFrame(video, 'clip-a')).resolves.toBe(true);
      expect(fallback.preCacheVideoFrame).not.toHaveBeenCalled();
      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video, {
        resizeWidth: 960,
        resizeHeight: 540,
        resizeQuality: 'medium',
      });
      expect(drawImage).toHaveBeenCalledWith(capturedBitmap, 0, 0, 256, 144);
      expect(capturedBitmap.close).toHaveBeenCalled();
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('reuses cached playback html video snapshots for transient seeking frames', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const capturedBitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(capturedBitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsPlaying(true);
    const videoState = { currentTime: 1, seeking: false };
    const video = createMutableVideo(videoState);
    const layer = {
      id: 'video-a',
      name: 'Video A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'video', videoElement: video, mediaTime: 1 },
      sourceClipId: 'clip-a',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    try {
      host.render([layer]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(drawImage).toHaveBeenCalledWith(capturedBitmap, 0, 0, 640, 360);

      videoState.currentTime = 1.04;
      videoState.seeking = true;
      host.render([{
        ...layer,
        source: { ...layer.source, mediaTime: 1.05 },
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
      });
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(bridge.presentSoftwareFrame).toHaveBeenLastCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({
              kind: 'cached-bitmap',
              cacheKey: 'html-video:clip-a:30:640x360',
              width: 640,
              height: 360,
            }),
          })],
        }),
        [],
      );
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('reuses cached html video snapshots while idle preview demand keeps rendering', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const capturedBitmap = { width: 640, height: 360, close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      drawImage,
    }) as unknown as CanvasRenderingContext2D);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(capturedBitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'test',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setTimelineVisualDemand(true);
    const videoState = {
      currentTime: 1,
      seeking: false,
      readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
    };
    const video = createMutableVideo(videoState);
    const layer = {
      id: 'video-a',
      name: 'Video A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'video', videoElement: video, mediaTime: 1 },
      sourceClipId: 'clip-a',
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    };

    try {
      host.render([layer]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(drawImage).toHaveBeenCalledWith(capturedBitmap, 0, 0, 640, 360);

      videoState.currentTime = 1.04;
      videoState.readyState = 0;
      host.render([{
        ...layer,
        source: { ...layer.source, mediaTime: 1.05 },
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(2);
      });
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(bridge.presentSoftwareFrame).toHaveBeenLastCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({
              kind: 'cached-bitmap',
              cacheKey: 'html-video:clip-a:30:640x360',
              width: 640,
              height: 360,
            }),
          })],
        }),
        [],
      );
    } finally {
      getContextSpy.mockRestore();
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('uses high-quality bounded html video snapshots while scrubbing', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 1920, height: 1080 } as unknown as OffscreenCanvas;
    const bitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 4, videoWidth: 3840, videoHeight: 2160 });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 4 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video, 960, 540, 'medium');
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          size: { x: 1920, y: 1080 },
          layers: [expect.objectContaining({
            id: 'video-a',
            source: expect.objectContaining({ kind: 'bitmap', bitmap, width: 256, height: 144 }),
          })],
        }),
        [bitmap],
      );
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('reports hidden document throttling in worker-presenting diagnostics', () => {
    const fallback = createFallback();
    const bridge = createBridge();
    installWorkerCanvasSupport({ width: 640, height: 360 } as unknown as OffscreenCanvas);
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
      ?? Object.getOwnPropertyDescriptor(document, 'hidden');
    const originalVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
      ?? Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });

    try {
      host.startRenderLoop(() => undefined);

      expect(host.getTelemetry().diagnostics).toMatchObject({
        documentVisibility: {
          hidden: true,
          visibilityState: 'hidden',
          hasFocus: false,
        },
        rafThrottledByHiddenDocument: true,
      });
    } finally {
      host.stopRenderLoopForDiagnostics();
      focusSpy.mockRestore();
      if (originalHidden) {
        Object.defineProperty(document, 'hidden', originalHidden);
      } else {
        Reflect.deleteProperty(document, 'hidden');
      }
      if (originalVisibilityState) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityState);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
    }
  });

  it('uses a transient seeking snapshot during scrubbing before holding the last frame', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const state = { currentTime: 1, seeking: true };
    const video = createMutableVideo(state);

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 1 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          state.seeking = false;
          resolve();
        }, 10);
      });

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video, 640, 360, 'medium');
      expect(host.getTelemetry().diagnostics).toMatchObject({
        heldEmptySoftwareFrameCount: 0,
        transientSoftwareFrameRetryCount: 0,
        lastSoftwareFrame: {
          presentableLayerCount: 1,
          skippedLayerCount: 0,
        },
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('uses a renderable transient video snapshot during scrub to avoid blank holds', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    const video = createVideo({ currentTime: 1, seeking: true });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 4 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expectPreviewBitmapResize(video, 640, 360, 'medium');
      expect(host.getTelemetry().diagnostics).toMatchObject({
        heldEmptySoftwareFrameCount: 0,
        transientSoftwareFrameRetryCount: 0,
        lastSoftwareFrame: {
          presentableLayerCount: 1,
          skippedLayerCount: 0,
        },
      });
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('coalesces stale async worker software packets instead of starting unbounded scrub work', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    let resolveBitmap: (bitmap: ImageBitmap) => void = () => undefined;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(() => new Promise<ImageBitmap>((resolve) => {
        resolveBitmap = resolve;
      })),
    });
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);
    const video = createVideo({ currentTime: 1 });

    try {
      host.render([{
        id: 'video-a',
        name: 'Video A',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'video', videoElement: video, mediaTime: 1 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);
      expectPreviewBitmapResize(video);

      host.render([{
        id: 'solid-newer',
        name: 'Solid Newer',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'solid', color: '#00ff00' },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(bridge.presentSoftwareFrame).not.toHaveBeenCalled();
      expect(host.getTelemetry().diagnostics).toMatchObject({
        coalescedSoftwareFrameCount: 1,
        inFlightSoftwareFrameCount: 1,
        pendingSoftwareFrameCount: 1,
      });

      host.render([{
        id: 'solid-latest',
        name: 'Solid Latest',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        source: { type: 'solid', color: '#0000ff' },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(host.getTelemetry().diagnostics).toMatchObject({
        coalescedSoftwareFrameCount: 2,
        inFlightSoftwareFrameCount: 1,
        pendingSoftwareFrameCount: 1,
      });
      resolveBitmap(bitmap);
      await vi.waitFor(() => {
        expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-presenting:render'),
        'preview',
        0,
        expect.objectContaining({
          layers: [expect.objectContaining({ id: 'solid-latest' })],
        }),
        [],
      );
      await vi.waitFor(() => {
        expect(host.getTelemetry().diagnostics).toMatchObject({
          staleSoftwareFrameCount: 1,
          inFlightSoftwareFrameCount: 0,
          pendingSoftwareFrameCount: 0,
        });
      });
      expect(bridge.presentSoftwareFrame).toHaveBeenCalledTimes(1);
      expect(bitmap.close).toHaveBeenCalled();
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('does not present an empty worker frame for an unavailable source layer', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    host.registerTargetCanvas('preview', canvas);

    host.render([{
      id: 'unsupported-video-a',
      name: 'Unsupported Video A',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'video' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(host.getTelemetry().diagnostics).toMatchObject({
        holdingLastSoftwareFrame: true,
        heldEmptySoftwareFrameCount: 1,
        lastSoftwareFrame: null,
        lastAttemptedSoftwareFrame: {
          sourceLayerCount: 1,
          presentableLayerCount: 0,
          skippedLayerCount: 1,
        },
      });
    });
    expect(bridge.presentSoftwareFrame).not.toHaveBeenCalled();
  });

  it('reuses the worker context when the same preview canvas is registered twice', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    const firstContext = host.registerTargetCanvas('preview', canvas);
    const secondContext = host.registerTargetCanvas('preview', canvas);

    expect(secondContext).toBe(firstContext);
    expect(HTMLCanvasElement.prototype.transferControlToOffscreen).toHaveBeenCalledTimes(1);
    expect(fallback.registerTargetCanvas).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps a transferred canvas reusable across immediate dev-mode unregister/register cycles', async () => {
    vi.useFakeTimers();
    try {
      const fallback = createFallback();
      const bridge = createBridge();
      const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
      installWorkerCanvasSupport(offscreen);
      const host = createWorkerPresentingRenderHostPort({
        fallback,
        getSelectionTelemetry: () => ({
          selectedId: 'worker-primary',
          selectedRole: 'primary',
          workerPrimaryRequested: true,
          workerPrimaryRegistered: true,
          workerPrimaryAvailable: true,
          blockers: [],
          reason: 'using worker primary render host',
        }),
        createBridge: () => bridge,
      });
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;

      const firstContext = host.registerTargetCanvas('preview', canvas);
      host.unregisterTargetCanvas('preview');
      const secondContext = host.registerTargetCanvas('preview', canvas);
      vi.runOnlyPendingTimers();

      expect(secondContext).toBe(firstContext);
      expect(HTMLCanvasElement.prototype.transferControlToOffscreen).toHaveBeenCalledTimes(1);
      expect(fallback.unregisterTargetCanvas).not.toHaveBeenCalled();
      expect(bridge.detachTargetSurface).not.toHaveBeenCalled();
      expect(bridge.sendCommand).not.toHaveBeenCalledWith({ type: 'unregisterTarget', targetId: 'preview' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a transferred canvas when strict worker-only mode is toggled on the same host', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    let strictWorkerOnly = false;
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: () => strictWorkerOnly,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    const firstContext = host.registerTargetCanvas('preview', canvas);
    strictWorkerOnly = true;
    const secondContext = host.registerTargetCanvas('preview', canvas);

    expect(secondContext).toBe(firstContext);
    expect(HTMLCanvasElement.prototype.transferControlToOffscreen).toHaveBeenCalledTimes(1);
    expect(fallback.registerTargetCanvas).not.toHaveBeenCalled();
    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-only',
      diagnostics: {
        strictWorkerOnly: true,
        targetIds: ['preview'],
      },
    });
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
  });

  it('presents a worker WebGPU test pattern and blocks software snapshots in worker GPU-only mode', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    host.registerTargetCanvas('preview', canvas);
    host.render([{
      id: 'solid-gpu-only',
      name: 'Solid GPU Only',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: { type: 'solid', color: '#00ff00' },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    const video = createVideo({ currentTime: 2 });
    expect(host.captureVideoFrameAtTime(video, 2, 'clip-a')).toBe(false);
    await expect(host.preCacheVideoFrame(video, 'clip-a')).resolves.toBe(false);
    host.ensureVideoFrameCached(video, 'clip-a');
    host.cacheFrameAtTime(video, 2, 'clip-a');

    expect(fallback.render).not.toHaveBeenCalled();
    expect(fallback.captureVideoFrameAtTime).not.toHaveBeenCalled();
    expect(fallback.preCacheVideoFrame).not.toHaveBeenCalled();
    expect(fallback.ensureVideoFrameCached).not.toHaveBeenCalled();
    expect(fallback.cacheFrameAtTime).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(bridge.presentGpuTestPattern).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        0,
        expect.any(Number),
      );
    });
    expect(bridge.presentSoftwareFrame).not.toHaveBeenCalled();
    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-gpu-only',
      presentationStrategy: 'worker-webgpu-present',
      diagnostics: {
        strictWorkerOnly: true,
        presentationStrategy: 'worker-webgpu-present',
        gpuOnlySoftwareFrameBlockedCount: 0,
        gpuOnlySoftwareSnapshotBlockedCount: 4,
        gpuOnlyTestPatternFrameCount: 1,
        presentationAttempts: 1,
      },
    });
    expect(getWorkerFirstCounterSourceSnapshot()).toMatchObject({
      presentedFrameId: 'preview:gpu-render-1:gpu-clear:1',
      workerGpuOnly: {
        frameState: 'gpu-test-pattern',
        previewFrames: 1,
        testPatternFrames: 1,
      },
    });
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
  });

  it('presents HTMLVideo frames through worker WebGPU when full WebCodecs playback is disabled', async () => {
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    const bitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    flags.useFullWebCodecsPlayback = false;
    flags.disableHtmlPreviewFallback = false;

    try {
      const fallback = createFallback();
      const bridge = createBridge();
      const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
      installWorkerCanvasSupport(offscreen);
      const host = createWorkerPresentingRenderHostPort({
        fallback,
        getSelectionTelemetry: () => ({
          selectedId: 'worker-primary',
          selectedRole: 'primary',
          workerPrimaryRequested: true,
          workerPrimaryRegistered: true,
          workerPrimaryAvailable: true,
          blockers: [],
          reason: 'using worker primary render host',
        }),
        createBridge: () => bridge,
        strictWorkerOnly: true,
        presentationStrategy: 'worker-webgpu-present',
      });
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const video = createVideo({ currentTime: 2 });

      host.registerTargetCanvas('preview', canvas);
      host.render([{
        id: 'html-video-layer',
        sourceClipId: 'clip-html',
        name: 'HTML Video Layer',
        visible: true,
        opacity: 0.5,
        blendMode: 'multiply',
        source: { type: 'video', videoElement: video, mediaTime: 2 },
        effects: [],
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
      }]);

      await vi.waitFor(() => {
        expect(bridge.presentGpuTransferredVideoFrames).toHaveBeenCalledTimes(1);
      });
      expect(bridge.loadWebCodecsSource).not.toHaveBeenCalled();
      expect(bridge.presentGpuWebCodecsFrame).not.toHaveBeenCalled();
      expect(bridge.startGpuWebCodecsStream).not.toHaveBeenCalled();
      expect(bridge.presentGpuTestPattern).not.toHaveBeenCalled();
      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      const transferCall = vi.mocked(bridge.presentGpuTransferredVideoFrames).mock.calls[0];
      expect(transferCall[0]).toContain('worker-gpu-only:render');
      expect(transferCall[1]).toBe('preview');
      expect(transferCall[2]).toBe(2);
      expect(transferCall[4]).toMatchObject([{
        sourceId: 'html-video:clip-html',
        mediaTime: 2,
        timestampSeconds: 2,
        opacity: 0.5,
        blendMode: 'multiply',
      }]);
      expect(transferCall[4][0].frame).toBe(bitmap);
      expect(transferCall[5]).toHaveLength(1);
      expect(transferCall[5][0]).toBe(bitmap);
    } finally {
      restoreCreateImageBitmap(originalCreateImageBitmap);
    }
  });

  it('presents file-backed worker WebGPU video frames without falling back to test patterns', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });

    host.registerTargetCanvas('preview', canvas);
    host.render([{
      id: 'video-gpu-only',
      name: 'Video GPU Only',
      sourceClipId: 'clip-video',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video',
        runtimeSessionKey: 'interactive:clip-video',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(bridge.loadWebCodecsSource).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video:interactive:clip-video'),
        2,
        2,
        expect.any(Number),
        expect.objectContaining({ mode: 'seek' }),
      );
    });

    expect(bridge.presentGpuTestPattern).not.toHaveBeenCalled();
    expect(fallback.render).not.toHaveBeenCalled();
    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-gpu-only',
      diagnostics: {
        gpuOnlyVideoFrameCount: 1,
        gpuOnlyVideoSourceLoadCount: 1,
        gpuOnlyTestPatternFrameCount: 0,
      },
    });
    expect(getWorkerFirstCounterSourceSnapshot()).toMatchObject({
      workerGpuOnly: {
        frameState: 'real-gpu-source',
        realSourceFrames: 1,
        testPatternFrames: 0,
      },
    });
  });

  it('keeps requesting paused worker GPU seeks until the target video frame is presentable', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    bridge.presentGpuWebCodecsFrame = vi.fn((requestId: string, _targetId: string) => Promise.resolve(output({
      commandType: 'gpu.presentWebCodecsFrame',
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: 'gpu.presentWebCodecsFrame',
          requestId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: 'Worker WebCodecs source did not provide a frame',
          recoverable: true,
        },
        {
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.presented': false,
            'workerGpu.videoFrame.sourceReady': true,
            'workerGpu.videoFrame.sourceFrameRate': 60,
            'workerGpu.videoFrame.decodePending': true,
            'workerGpu.videoFrame.targetMediaTime': 6,
            'workerGpu.videoFrame.mode': 'seek',
            'workerGpu.videoFrame.streaming': false,
          },
        },
      ],
      presentedFrameId: null,
    })));
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });

    host.registerTargetCanvas('preview', canvas);
    host.render([{
      id: 'video-gpu-only-retry',
      name: 'Video GPU Only Retry',
      sourceClipId: 'clip-video-retry',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-retry',
        mediaTime: 6,
        targetMediaTime: 6,
        runtimeSourceId: 'media:media-video-retry',
        runtimeSessionKey: 'interactive:clip-video-retry',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-retry:interactive:clip-video-retry'),
        6,
        6,
        expect.any(Number),
        expect.objectContaining({ mode: 'seek' }),
      );
    });

    expect(host.getTelemetry().diagnostics).toMatchObject({
      renderRequested: true,
      gpuOnlyVideoFrameFailureCount: 1,
    });
    expect(fallback.render).not.toHaveBeenCalled();
    expect(bridge.presentGpuTestPattern).not.toHaveBeenCalled();
  });

  it('queues rapid paused worker GPU frame-step seeks instead of dropping intermediate targets', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    let resolveFirstPresent: ((value: WorkerRenderHostRuntimeJobOutput) => void) | null = null;
    bridge.presentGpuWebCodecsFrame = vi.fn((
      requestId: string,
      targetId: string,
      sourceId: string,
      timelineTime: number,
      mediaTime: number,
      sequence: number,
    ) => {
      const result = output({
        commandType: 'gpu.presentWebCodecsFrame',
        statusEvents: [{
          type: 'frame-presented',
          requestId,
          targetId,
          timelineTime,
        }],
        presentedFrameId: `${targetId}:${requestId}:gpu-video:${sequence}`,
        webCodecs: {
          status: {
            sourceId,
            ready: true,
            width: 1920,
            height: 1080,
            frameRate: 60,
            currentTime: mediaTime,
            hasFrame: true,
            pendingSeekTime: null,
            decodePending: false,
          },
          frame: null,
        },
      });
      if (vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls.length === 1) {
        return new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
          resolveFirstPresent = () => resolve(result);
        });
      }
      return Promise.resolve(result);
    }) as typeof bridge.presentGpuWebCodecsFrame;
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-frame-step',
      name: 'Video GPU Only Frame Step',
      sourceClipId: 'clip-video-frame-step',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-frame-step',
        mediaTime: 6,
        targetMediaTime: 6,
        runtimeSourceId: 'media:media-video-frame-step',
        runtimeSessionKey: 'interactive:clip-video-frame-step',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.render([layer]);
    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(1);
    });

    host.render([{ ...layer, source: { ...layer.source, mediaTime: 6 + 1 / 60, targetMediaTime: 6 + 1 / 60 } }]);
    host.render([{ ...layer, source: { ...layer.source, mediaTime: 6 + 2 / 60, targetMediaTime: 6 + 2 / 60 } }]);

    expect(host.getTelemetry().diagnostics).toMatchObject({
      pendingGpuFrameCount: 2,
    });

    resolveFirstPresent?.(output());
    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(3);
    });
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls.map((call) => call[4])).toEqual([
      6,
      6 + 1 / 60,
      6 + 2 / 60,
    ]);
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls.every((call) => {
      const options = call[6] as { mode?: string } | undefined;
      return options?.mode === 'seek';
    })).toBe(true);
  });

  it('uses streaming WebCodecs mode for 1x worker WebGPU playback and fast mode for faster playback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream',
      name: 'Video GPU Only Stream',
      sourceClipId: 'clip-video-stream',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream',
        runtimeSessionKey: 'interactive:clip-video-stream',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    host.setIsPlaying(true);
    host.render([layer]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:stream:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-stream:interactive:clip-video-stream'),
        2,
        2,
        expect.any(Number),
        expect.objectContaining({ playbackRate: 1, targetFps: 60, timeoutMs: 48 }),
      );
    });
    expect(bridge.presentGpuWebCodecsFrame).not.toHaveBeenCalled();

    vi.mocked(bridge.presentGpuWebCodecsFrame).mockClear();
    vi.mocked(bridge.startGpuWebCodecsStream).mockClear();
    host.setPlaybackSpeed(2);
    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 2.5,
        targetMediaTime: 2.5,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-stream:interactive:clip-video-stream'),
        2.5,
        2.5,
        expect.any(Number),
        expect.objectContaining({ mode: 'fast', timeoutMs: 90 }),
      );
    });

    vi.mocked(bridge.presentGpuWebCodecsFrame).mockClear();
    host.setIsScrubbing(true);
    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 2.55,
        targetMediaTime: 2.55,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-stream:interactive:clip-video-stream'),
        2.55,
        2.55,
        expect.any(Number),
        expect.objectContaining({ mode: 'scrub', timeoutMs: 32 }),
      );
    });
  });

  it('clears a failed worker GPU stream start so the next render can retry', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    bridge.startGpuWebCodecsStream = vi.fn((requestId: string) => Promise.resolve(output({
      commandType: 'gpu.startWebCodecsStream',
      statusEvents: [
        {
          type: 'error',
          message: 'Worker WebCodecs layer did not provide a frame',
          recoverable: true,
        },
        {
          type: 'stats',
          requestId,
          stats: {
            'workerGpu.videoFrame.presented': false,
            'workerGpu.videoFrame.sourceReady': true,
            'workerGpu.videoFrame.sourceFrameRate': 60,
            'workerGpu.videoFrame.targetMediaTime': 2,
            'workerGpu.videoFrame.mode': 'stream',
            'workerGpu.videoFrame.streaming': true,
            'workerGpu.videoFrame.error': 'Worker WebCodecs layer did not provide a frame',
          },
        },
      ],
      presentedFrameId: null,
    }))) as WorkerRenderHostRuntimeBridge['startGpuWebCodecsStream'];
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream-retry',
      name: 'Video GPU Only Stream Retry',
      sourceClipId: 'clip-video-stream-retry',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream-retry',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream-retry',
        runtimeSessionKey: 'interactive:clip-video-stream-retry',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    host.setIsPlaying(true);
    host.render([layer]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(host.getTelemetry().diagnostics).toMatchObject({
        activeGpuStreamCount: 0,
        pendingGpuStreamStartCount: 0,
        gpuOnlyVideoFrameFailureCount: 1,
        renderRequested: true,
      });
    });

    host.render([layer]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(2);
    });
  });

  it('uses fast Worker WebCodecs seeks for large active GPU scrub jumps', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-adaptive-scrub',
      name: 'Video GPU Only Adaptive Scrub',
      sourceClipId: 'clip-video-adaptive-scrub',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-adaptive-scrub',
        mediaTime: 3,
        targetMediaTime: 3,
        runtimeSourceId: 'media:media-video-adaptive-scrub',
        runtimeSessionKey: 'interactive:clip-video-adaptive-scrub',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    host.setIsScrubbing(true);
    host.render([layer]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledWith(
        expect.stringContaining('worker-gpu-only:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-adaptive-scrub:interactive:clip-video-adaptive-scrub'),
        3,
        3,
        expect.any(Number),
        expect.objectContaining({ mode: 'scrub' }),
      );
    });

    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 3.05,
        targetMediaTime: 3.05,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls[1]?.[6]).toMatchObject({
      mode: 'scrub',
    });

    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 4,
        targetMediaTime: 4,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(3);
    });
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls[2]?.[6]).toMatchObject({
      mode: 'fast',
    });
  });

  it('keeps normal 1x worker GPU playback on a worker-owned stream instead of queueing per-frame presents', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream-queue',
      name: 'Video GPU Only Stream Queue',
      sourceClipId: 'clip-video-stream-queue',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream-queue',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream-queue',
        runtimeSessionKey: 'interactive:clip-video-stream-queue',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setIsPlaying(true);
    host.render([layer]);
    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });

    host.render([{ ...layer, source: { ...layer.source, mediaTime: 2 + 1 / 60, targetMediaTime: 2 + 1 / 60 } }]);
    host.render([{ ...layer, source: { ...layer.source, mediaTime: 2 + 2 / 60, targetMediaTime: 2 + 2 / 60 } }]);

    expect(host.getTelemetry().diagnostics).toMatchObject({
      activeGpuStreamCount: 1,
    });
    expect(bridge.presentGpuWebCodecsFrame).not.toHaveBeenCalled();
    expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0]).toEqual([
      expect.stringContaining('worker-gpu-only:stream:render'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-stream-queue:interactive:clip-video-stream-queue'),
      2,
      2,
      expect.any(Number),
      expect.objectContaining({ playbackRate: 1, targetFps: 60 }),
    ]);
  });

  it('passes visible video layer blend, opacity, and inline effects into worker GPU WebCodecs streams', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const bottomFile = new File(['bottom-video-source'], 'worker-bottom.mp4', { type: 'video/mp4' });
    const topFile = new File(['top-video-source'], 'worker-top.mp4', { type: 'video/mp4' });
    Object.defineProperty(bottomFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    Object.defineProperty(topFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(16)),
    });
    const bottomLayer = {
      id: 'video-gpu-only-stream-bottom',
      name: 'Video GPU Only Stream Bottom',
      sourceClipId: 'clip-video-stream-bottom',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file: bottomFile,
        mediaFileId: 'media-video-stream-bottom',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream-bottom',
        runtimeSessionKey: 'interactive:clip-video-stream-bottom',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;
    const topLayer = {
      id: 'video-gpu-only-stream-top',
      name: 'Video GPU Only Stream Top',
      sourceClipId: 'clip-video-stream-top',
      visible: true,
      opacity: 0.5,
      blendMode: 'screen',
      source: {
        type: 'video',
        file: topFile,
        mediaFileId: 'media-video-stream-top',
        mediaTime: 4,
        targetMediaTime: 4,
        runtimeSourceId: 'media:media-video-stream-top',
        runtimeSessionKey: 'interactive:clip-video-stream-top',
      },
      effects: [
        { id: 'brightness-top', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 } },
        { id: 'invert-top', name: 'Invert', type: 'invert', enabled: true, params: {} },
        { id: 'hue-top', name: 'Hue Shift', type: 'hue-shift', enabled: true, params: { shift: 0.25 } },
        { id: 'pixelate-top', name: 'Pixelate', type: 'pixelate', enabled: true, params: { size: 12 } },
        { id: 'mirror-top', name: 'Mirror', type: 'mirror', enabled: true, params: { horizontal: true } },
        { id: 'rgb-top', name: 'RGB Split', type: 'rgb-split', enabled: true, params: { amount: 0.02, angle: 1.2 } },
        { id: 'blur-top', name: 'Gaussian Blur', type: 'gaussian-blur', enabled: true, params: { radius: 6 } },
        { id: 'exposure-top', name: 'Exposure', type: 'exposure', enabled: true, params: { exposure: 0.5, offset: 0.1, gamma: 1.2 } },
        { id: 'temperature-top', name: 'Temperature', type: 'temperature', enabled: true, params: { temperature: 0.2, tint: -0.1 } },
        { id: 'vibrance-top', name: 'Vibrance', type: 'vibrance', enabled: true, params: { amount: 0.4 } },
        { id: 'threshold-top', name: 'Threshold', type: 'threshold', enabled: true, params: { level: 0.45 } },
        { id: 'posterize-top', name: 'Posterize', type: 'posterize', enabled: true, params: { levels: 5 } },
        { id: 'vignette-top', name: 'Vignette', type: 'vignette', enabled: true, params: { amount: 0.6, size: 0.7, softness: 0.2, roundness: 1.3 } },
        { id: 'chroma-top', name: 'Chroma Key', type: 'chroma-key', enabled: true, params: { keyColor: 'blue', tolerance: 0.3, softness: 0.15, spillSuppression: 0.7 } },
        { id: 'scanlines-top', name: 'Scanlines', type: 'scanlines', enabled: true, params: { density: 7, opacity: 0.25, speed: 0.5 } },
        { id: 'grain-top', name: 'Grain', type: 'grain', enabled: true, params: { amount: 0.2, size: 1.5, speed: 2 } },
        { id: 'wave-top', name: 'Wave', type: 'wave', enabled: true, params: { amplitudeX: 0.03, amplitudeY: 0.04, frequencyX: 8, frequencyY: 9 } },
        { id: 'twirl-top', name: 'Twirl', type: 'twirl', enabled: true, params: { amount: 2, radius: 0.4, centerX: 0.45, centerY: 0.55 } },
        { id: 'bulge-top', name: 'Bulge', type: 'bulge', enabled: true, params: { amount: 0.8, radius: 0.35, centerX: 0.4, centerY: 0.6 } },
        { id: 'sharpen-top', name: 'Sharpen', type: 'sharpen', enabled: true, params: { amount: 0.7, radius: 1.5 } },
        { id: 'edge-top', name: 'Edge Detect', type: 'edge-detect', enabled: true, params: { strength: 1.2, invert: true } },
        { id: 'glow-top', name: 'Glow', type: 'glow', enabled: true, params: { amount: 0.9, threshold: 0.55, radius: 12 } },
        {
          id: 'levels-top',
          name: 'Levels',
          type: 'levels',
          enabled: true,
          params: { inputBlack: 0.1, inputWhite: 0.9, gamma: 1.1, outputBlack: 0.05, outputWhite: 0.95 },
        },
      ],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setIsPlaying(true);
    host.render([topLayer, bottomLayer]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0]).toEqual([
      expect.stringContaining('worker-gpu-only:stream:render'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-stream-top:interactive:clip-video-stream-top'),
      4,
      4,
      expect.any(Number),
      expect.objectContaining({
        playbackRate: 1,
        targetFps: 60,
        layers: [
          expect.objectContaining({
            sourceId: expect.stringContaining('media-video-stream-bottom'),
            opacity: 1,
            blendMode: 'normal',
          }),
          expect.objectContaining({
            sourceId: expect.stringContaining('media-video-stream-top'),
            opacity: 0.5,
            blendMode: 'screen',
            inlineBrightness: 0.2,
            inlineContrast: 1,
            inlineSaturation: 1,
            inlineInvert: true,
            hueShift: 0.25,
            pixelateSize: 12,
            mirrorHorizontal: true,
            rgbSplitAmount: 0.02,
            rgbSplitAngle: 1.2,
            blurRadius: 6,
            exposure: 0.5,
            exposureOffset: 0.1,
            exposureGamma: 1.2,
            temperature: 0.2,
            tint: -0.1,
            vibrance: 0.4,
            thresholdLevel: 0.45,
            posterizeLevels: 5,
            vignetteAmount: 0.6,
            vignetteSize: 0.7,
            vignetteSoftness: 0.2,
            vignetteRoundness: 1.3,
            chromaKeyMode: 2,
            chromaKeyTolerance: 0.3,
            chromaKeySoftness: 0.15,
            chromaKeySpill: 0.7,
            scanlineDensity: 7,
            scanlineOpacity: 0.25,
            scanlineSpeed: 0.5,
            grainAmount: 0.2,
            grainSize: 1.5,
            grainSpeed: 2,
            waveAmplitudeX: 0.03,
            waveAmplitudeY: 0.04,
            waveFrequencyX: 8,
            waveFrequencyY: 9,
            twirlAmount: 2,
            twirlRadius: 0.4,
            twirlCenterX: 0.45,
            twirlCenterY: 0.55,
            bulgeAmount: 0.8,
            bulgeRadius: 0.35,
            bulgeCenterX: 0.4,
            bulgeCenterY: 0.6,
            sharpenAmount: 0.7,
            sharpenRadius: 1.5,
            edgeDetectStrength: 1.2,
            edgeDetectInvert: true,
            glowAmount: 0.9,
            glowThreshold: 0.55,
            glowRadius: 12,
            levelsInputBlack: 0.1,
            levelsInputWhite: 0.9,
            levelsGamma: 1.1,
            levelsOutputBlack: 0.05,
            levelsOutputWhite: 0.95,
            levelsEnabled: true,
          }),
        ],
      }),
    ]);
  });

  it('loads visible worker GPU WebCodecs video sources in parallel before starting a multi-layer stream', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const bottomLoad = createDeferred<WorkerRenderHostRuntimeJobOutput>();
    const topLoad = createDeferred<WorkerRenderHostRuntimeJobOutput>();
    bridge.loadWebCodecsSource = vi.fn((requestId: string, sourceId: string) => {
      if (sourceId.includes('media-video-parallel-bottom')) return bottomLoad.promise;
      if (sourceId.includes('media-video-parallel-top')) return topLoad.promise;
      return Promise.resolve(output({
        commandType: 'loadWebCodecsSource',
        presentedFrameId: null,
        webCodecs: { status: { sourceId, ready: true }, frame: null },
      }));
    }) as WorkerRenderHostRuntimeBridge['loadWebCodecsSource'];
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const bottomFile = new File(['bottom-video-source'], 'worker-parallel-bottom.mp4', { type: 'video/mp4' });
    const topFile = new File(['top-video-source'], 'worker-parallel-top.mp4', { type: 'video/mp4' });
    Object.defineProperty(bottomFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    Object.defineProperty(topFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(16)),
    });
    const bottomLayer = {
      id: 'video-gpu-only-parallel-bottom',
      name: 'Video GPU Only Parallel Bottom',
      sourceClipId: 'clip-video-parallel-bottom',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file: bottomFile,
        mediaFileId: 'media-video-parallel-bottom',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-parallel-bottom',
        runtimeSessionKey: 'interactive:clip-video-parallel-bottom',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;
    const topLayer = {
      id: 'video-gpu-only-parallel-top',
      name: 'Video GPU Only Parallel Top',
      sourceClipId: 'clip-video-parallel-top',
      visible: true,
      opacity: 0.75,
      blendMode: 'screen',
      source: {
        type: 'video',
        file: topFile,
        mediaFileId: 'media-video-parallel-top',
        mediaTime: 4,
        targetMediaTime: 4,
        runtimeSourceId: 'media:media-video-parallel-top',
        runtimeSessionKey: 'interactive:clip-video-parallel-top',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setIsPlaying(true);
    host.render([topLayer, bottomLayer]);

    await vi.waitFor(() => {
      expect(bridge.loadWebCodecsSource).toHaveBeenCalledTimes(2);
    });
    expect(bridge.startGpuWebCodecsStream).not.toHaveBeenCalled();

    topLoad.resolve(output({
      commandType: 'loadWebCodecsSource',
      presentedFrameId: null,
      webCodecs: { status: { sourceId: 'top', ready: true }, frame: null },
    }));
    bottomLoad.resolve(output({
      commandType: 'loadWebCodecsSource',
      presentedFrameId: null,
      webCodecs: { status: { sourceId: 'bottom', ready: true }, frame: null },
    }));

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0][6]).toEqual(
      expect.objectContaining({
        layers: [
          expect.objectContaining({ sourceId: expect.stringContaining('media-video-parallel-bottom') }),
          expect.objectContaining({ sourceId: expect.stringContaining('media-video-parallel-top') }),
        ],
      }),
    );
  });

  it('uses a reverse WebCodecs stream session for 1x reverse worker WebGPU playback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-reverse-stream',
      name: 'Video GPU Only Reverse Stream',
      sourceClipId: 'clip-video-reverse-stream',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-reverse-stream',
        mediaTime: 8,
        targetMediaTime: 8,
        runtimeSourceId: 'media:media-video-reverse-stream',
        runtimeSessionKey: 'interactive:clip-video-reverse-stream',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setPlaybackSpeed(-1);
    host.setIsPlaying(true);
    host.render([layer]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    expect(bridge.presentGpuWebCodecsFrame).not.toHaveBeenCalled();
    expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0]).toEqual([
      expect.stringContaining('worker-gpu-only:stream'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-reverse-stream:interactive:clip-video-reverse-stream'),
      8,
      8,
      expect.any(Number),
      expect.objectContaining({ playbackRate: -1, timeoutMs: 48 }),
    ]);
  });

  it('restarts worker GPU playback streaming after the preview target is rebound during playback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const raf = installAnimationFrameQueue();
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const replacementCanvas = document.createElement('canvas');
    replacementCanvas.width = 640;
    replacementCanvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream-rebind',
      name: 'Video GPU Only Stream Rebind',
      sourceClipId: 'clip-video-stream-rebind',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream-rebind',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream-rebind',
        runtimeSessionKey: 'interactive:clip-video-stream-rebind',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    try {
      host.registerTargetCanvas('preview', canvas);
      await vi.waitFor(() => {
        expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
      });
      host.setIsPlaying(true);
      host.render([layer]);
      await vi.waitFor(() => {
        expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
      });

      host.startRenderLoop(() => host.render([layer]));
      raf.flushFrames();
      vi.mocked(bridge.startGpuWebCodecsStream).mockClear();
      vi.mocked(bridge.detachTargetSurface).mockClear();
      vi.mocked(bridge.sendCommand).mockClear();

      const stopDeferred = createDeferred<WorkerRenderHostRuntimeJobOutput>();
      vi.mocked(bridge.stopGpuWebCodecsStream).mockImplementationOnce(() => stopDeferred.promise);

      host.unregisterTargetCanvas('preview');
      host.registerTargetCanvas('preview', replacementCanvas);
      await vi.waitFor(() => {
        expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(2);
      });

      raf.flushFrames();
      expect(bridge.detachTargetSurface).not.toHaveBeenCalled();
      expect(bridge.sendCommand).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'unregisterTarget' }));
      expect(bridge.startGpuWebCodecsStream).not.toHaveBeenCalled();

      stopDeferred.resolve(output({
        commandType: 'gpu.stopWebCodecsStream',
        presentedFrameId: null,
        statusEvents: [{
          type: 'stats',
          requestId: 'worker-gpu-only:stop-stream',
          stats: {
            'workerGpu.videoFrame.workerStream.active': false,
            'workerGpu.videoFrame.workerStream.targetId': 'preview',
            'workerGpu.videoFrame.workerStream.sourceId': 'gpu-video:runtime:media:media-video-stream-rebind:interactive:clip-video-stream-rebind',
            'workerGpu.videoFrame.mode': 'stream',
            'workerGpu.videoFrame.streaming': false,
          },
        }],
      }));
      await vi.waitFor(() => {
        expect(bridge.stopGpuWebCodecsStream).toHaveBeenCalledTimes(1);
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(raf.flushNextFrame()).toBe(true);
      await vi.waitFor(() => {
        expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
      });
      expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0]).toEqual([
        expect.stringContaining('worker-gpu-only:stream:render'),
        'preview',
        expect.stringContaining('gpu-video:runtime:media:media-video-stream-rebind:interactive:clip-video-stream-rebind'),
        2,
        2,
        expect.any(Number),
        expect.objectContaining({ playbackRate: 1, targetFps: 60 }),
      ]);
    } finally {
      host.stopRenderLoopForDiagnostics();
      raf.restore();
    }
  });

  it('reanchors a normal 1x worker GPU stream when host timeline media time drifts from the stream clock', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream-reanchor',
      name: 'Video GPU Only Stream Reanchor',
      sourceClipId: 'clip-video-stream-reanchor',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream-reanchor',
        mediaTime: 2,
        targetMediaTime: 2,
        runtimeSourceId: 'media:media-video-stream-reanchor',
        runtimeSessionKey: 'interactive:clip-video-stream-reanchor',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setIsPlaying(true);
    host.render([layer]);
    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });

    vi.mocked(bridge.startGpuWebCodecsStream).mockClear();
    vi.mocked(bridge.stopGpuWebCodecsStream).mockClear();
    host.render([{
      ...layer,
      source: { ...layer.source, mediaTime: 2.25, targetMediaTime: 2.25 },
    }]);

    await vi.waitFor(() => {
      expect(bridge.stopGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    expect(bridge.startGpuWebCodecsStream).not.toHaveBeenCalled();

    host.render([{
      ...layer,
      source: { ...layer.source, mediaTime: 2.25, targetMediaTime: 2.25 },
    }]);

    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(bridge.startGpuWebCodecsStream).mock.calls[0]).toEqual([
      expect.stringContaining('worker-gpu-only:stream:render'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-stream-reanchor:interactive:clip-video-stream-reanchor'),
      2.25,
      2.25,
      expect.any(Number),
      expect.objectContaining({ playbackRate: 1, targetFps: 60 }),
    ]);
    expect(bridge.presentGpuWebCodecsFrame).not.toHaveBeenCalled();
  });

  it('holds the last nearby stream frame when pausing worker GPU playback', async () => {
    const fallback = createFallback();
    const bridge = createBridge();
    const offscreen = { width: 640, height: 360 } as unknown as OffscreenCanvas;
    installWorkerCanvasSupport(offscreen);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge: () => bridge,
      strictWorkerOnly: true,
      presentationStrategy: 'worker-webgpu-present',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(12)),
    });
    const layer = {
      id: 'video-gpu-only-stream-pause-hold',
      name: 'Video GPU Only Stream Pause Hold',
      sourceClipId: 'clip-video-stream-pause-hold',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      source: {
        type: 'video',
        file,
        mediaFileId: 'media-video-stream-pause-hold',
        mediaTime: 11.016666,
        targetMediaTime: 11.016666,
        runtimeSourceId: 'media:media-video-stream-pause-hold',
        runtimeSessionKey: 'interactive:clip-video-stream-pause-hold',
      },
      effects: [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    } as const;

    host.registerTargetCanvas('preview', canvas);
    await vi.waitFor(() => {
      expect(bridge.attachTargetSurface).toHaveBeenCalledTimes(1);
    });
    host.setIsPlaying(true);
    host.render([layer]);
    await vi.waitFor(() => {
      expect(bridge.startGpuWebCodecsStream).toHaveBeenCalledTimes(1);
    });

    vi.mocked(bridge.presentGpuWebCodecsFrame).mockClear();
    host.setIsPlaying(false);
    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 10.99099,
        targetMediaTime: 10.99099,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls[0]).toEqual([
      expect.stringContaining('worker-gpu-only:render'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-stream-pause-hold:interactive:clip-video-stream-pause-hold'),
      10.99099,
      11.016666,
      expect.any(Number),
      expect.objectContaining({ mode: 'seek', timeoutMs: 120 }),
    ]);

    host.render([{
      ...layer,
      source: {
        ...layer.source,
        mediaTime: 10.983333,
        targetMediaTime: 10.983333,
      },
    }]);

    await vi.waitFor(() => {
      expect(bridge.presentGpuWebCodecsFrame).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(bridge.presentGpuWebCodecsFrame).mock.calls[1]).toEqual([
      expect.stringContaining('worker-gpu-only:render'),
      'preview',
      expect.stringContaining('gpu-video:runtime:media:media-video-stream-pause-hold:interactive:clip-video-stream-pause-hold'),
      10.983333,
      10.983333,
      expect.any(Number),
      expect.objectContaining({ mode: 'seek', timeoutMs: 120 }),
    ]);
  });

  it('serves worker-owned diagnostics in strict worker-only mode without touching fallback proxies', () => {
    const fallback = createFallback();
    installWorkerCanvasSupport({ width: 640, height: 360 } as unknown as OffscreenCanvas);
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
      strictWorkerOnly: true,
    });
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;

    host.registerTargetCanvas('preview', canvas);

    expect(host.getIsExporting()).toBe(false);
    expect(host.getLayerCollector()).toBeNull();
    expect(host.getRenderDispatcherDebugSnapshot()).toBeNull();
    expect(host.getScrubbingCacheStats()).toMatchObject({
      count: 0,
      maxCount: 0,
      fillPct: 0,
      approxMemoryMB: 0,
      evictions: 0,
      budgetMode: 'static',
      background: {
        activeSessions: 0,
        queuedFrames: 0,
        activePreloads: 0,
      },
    });
    expect(host.getWorkerFirstCacheRuntimeSnapshot()).toMatchObject({
      records: [],
    });
    expect(host.getDebugInfrastructureState()).toMatchObject({
      hasDevice: false,
      hasPreviewContext: true,
      targetCanvasCount: 1,
    });
    expect(host.getTelemetry()).toMatchObject({
      diagnostics: {
        fallbackBlockedCount: 0,
        fallbackBlockedOperations: [],
      },
    });
  });

  it('keeps the main fallback usable when canvas transfer fails', () => {
    const fallback = createFallback();
    installWorkerCanvasSupport({ width: 1, height: 1 } as unknown as OffscreenCanvas);
    vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mockImplementationOnce(() => {
      throw new Error('already has a rendering context');
    });
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
    });
    const canvas = document.createElement('canvas');
    const layers = [{ id: 'layer-a' }] as never;

    const context = host.registerTargetCanvas('preview', canvas);
    host.render(layers);

    expect(context).toEqual({ label: 'fallback-context' });
    expect(fallback.registerTargetCanvas).toHaveBeenCalledWith('preview', canvas);
    expect(fallback.render).toHaveBeenCalledWith(layers);
  });

  it('blocks main fallback registration when worker-only canvas transfer fails', () => {
    const fallback = createFallback();
    installWorkerCanvasSupport({ width: 1, height: 1 } as unknown as OffscreenCanvas);
    vi.mocked(HTMLCanvasElement.prototype.transferControlToOffscreen).mockImplementationOnce(() => {
      throw new Error('already has a rendering context');
    });
    const host = createWorkerPresentingRenderHostPort({
      fallback,
      getSelectionTelemetry: () => ({
        selectedId: 'worker-primary',
        selectedRole: 'primary',
        workerPrimaryRequested: true,
        workerPrimaryRegistered: true,
        workerPrimaryAvailable: true,
        blockers: [],
        reason: 'using worker primary render host',
      }),
      createBridge,
      strictWorkerOnly: true,
    });
    const canvas = document.createElement('canvas');
    const layers = [{ id: 'layer-a' }] as never;

    const context = host.registerTargetCanvas('preview', canvas);
    host.render(layers);

    expect(context).toBeNull();
    expect(fallback.registerTargetCanvas).not.toHaveBeenCalled();
    expect(fallback.render).not.toHaveBeenCalled();
    expect(host.getTelemetry()).toMatchObject({
      mode: 'worker-only',
      diagnostics: {
        strictWorkerOnly: true,
        fallbackBlockedCount: 1,
        fallbackBlockedOperations: ['registerTargetCanvas:transfer-failed'],
      },
    });
  });
});
