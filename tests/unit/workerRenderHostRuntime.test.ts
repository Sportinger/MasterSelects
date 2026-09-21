import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeJobClient,
  WorkerRuntimeHost,
  type RuntimeWorkerInboundMessage,
  type RuntimeWorkerOutboundMessage,
  type RuntimeWorkerTransport,
} from '../../src/runtime/worker';
import {
  WORKER_RENDER_HOST_RUNTIME_HANDLERS,
  WORKER_SOFTWARE_BITMAP_CACHE_ENTRY_LIMIT,
} from '../../src/services/render/workerRenderHostRuntimeHandlers';
import { WorkerRenderHostRuntimeBridge } from '../../src/services/render/workerRenderHostRuntimeBridge';
import type { RenderCommandTarget } from '../../src/engine/render/contracts/workerRenderGraph';
import { DEFAULT_PRIMARY_COLOR_PARAMS } from '../../src/types/colorCorrection';

class InMemoryRuntimeWorkerTransport implements RuntimeWorkerTransport {
  private readonly listeners = new Set<(event: MessageEvent<RuntimeWorkerOutboundMessage>) => void>();
  private readonly host = new WorkerRuntimeHost({
    handlers: WORKER_RENDER_HOST_RUNTIME_HANDLERS,
    now: () => '2026-06-16T00:00:00.000Z',
    postMessage: (message) => {
      queueMicrotask(() => {
        const event = { data: message } as MessageEvent<RuntimeWorkerOutboundMessage>;
        this.listeners.forEach((listener) => listener(event));
      });
    },
  });

  postMessage(message: RuntimeWorkerInboundMessage): void {
    this.host.handleMessage(message);
  }

  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ): void {
    this.listeners.delete(listener);
  }
}

function createBridge(): WorkerRenderHostRuntimeBridge {
  let nowMs = 1000;
  return new WorkerRenderHostRuntimeBridge({
    client: new RuntimeJobClient(new InMemoryRuntimeWorkerTransport()),
    now: () => {
      nowMs += 5;
      return nowMs;
    },
  });
}

const target: RenderCommandTarget = {
  id: 'preview',
  compositionId: 'active',
  size: { x: 1920, y: 1080 },
  devicePixelRatio: 1,
  showTransparencyGrid: false,
  presentation: 'main-canvas',
};

function createFakeWorkerGpuSurface() {
  const workDone = vi.fn(async () => undefined);
  const submit = vi.fn();
  const finish = vi.fn(() => ({ label: 'command-buffer' }));
  const passEnd = vi.fn();
  const beginRenderPass = vi.fn(() => ({ end: passEnd }));
  const createCommandEncoder = vi.fn(() => ({
    beginRenderPass,
    finish,
  }));
  const configure = vi.fn();
  const createView = vi.fn(() => ({ label: 'texture-view' }));
  const getCurrentTexture = vi.fn(() => ({ createView }));
  const context = {
    configure,
    getCurrentTexture,
  };
  const canvas = {
    width: 320,
    height: 180,
    getContext: vi.fn((kind: string) => kind === 'webgpu' ? context : null),
  } as unknown as OffscreenCanvas & {
    getContext: ReturnType<typeof vi.fn>;
  };
  const device = {
    features: new Set<string>(),
    limits: { maxTextureDimension2D: 8192 },
    queue: {
      submit,
      onSubmittedWorkDone: workDone,
    },
    createCommandEncoder,
    destroy: vi.fn(),
  };
  const adapter = {
    features: new Set<string>(),
    limits: { maxTextureDimension2D: 8192 },
    requestDevice: vi.fn(async () => device),
  };
  const gpu = {
    requestAdapter: vi.fn(async () => adapter),
    getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm' as GPUTextureFormat),
  };

  return {
    beginRenderPass,
    canvas,
    configure,
    createCommandEncoder,
    createView,
    finish,
    getCurrentTexture,
    gpu,
    passEnd,
    submit,
    workDone,
  };
}

describe('worker render host runtime bridge', () => {
  it('runs render-host commands through the runtime worker without claiming presentation', async () => {
    const bridge = createBridge();

    try {
      const initialized = await bridge.initialize('worker-runtime-a', 'worker-cpu-present');
      expect(initialized).toMatchObject({
        accepted: true,
        commandType: 'initialize',
        initialized: true,
        rendererId: 'worker-runtime-a',
        strategy: 'worker-cpu-present',
        presentedFrameId: null,
      });
      expect(initialized.statusEvents).toEqual([{ type: 'initialized', rendererId: 'worker-runtime-a' }]);

      const registered = await bridge.registerTarget(target);
      expect(registered.targetIds).toEqual(['preview']);
      expect(registered.cache.entries).toBe(1);

      const rendered = await bridge.renderNow('render-1', 'preview', 1.25);
      expect(rendered.statusEvents).toEqual([{
        type: 'command-accepted',
        commandType: 'RenderNow',
        requestId: 'render-1',
        presentation: 'not-presenting',
      }]);
      expect(rendered.scheduler).toMatchObject({
        queueDepth: 0,
        counters: {
          admitted: 1,
          enqueued: 1,
          started: 1,
          completed: 1,
        },
      });
      expect(rendered.presentedFrameId).toBeNull();
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
    }
  });

  it('reports worker-side scheduler and target state through collectStats', async () => {
    const bridge = createBridge();

    try {
      await bridge.initialize('worker-runtime-b', 'worker-cpu-present');
      await bridge.registerTarget(target);
      await bridge.renderDeadline({
        requestId: 'deadline-1',
        targetId: 'preview',
        timelineTime: 2,
        deadlineTimeMs: 2000,
        exact: false,
      });

      const stats = await bridge.collectStats('stats-1');
      expect(stats.targetIds).toEqual(['preview']);
      expect(stats.scheduler.counters.completed).toBe(1);
      expect(stats.statusEvents).toEqual([{
        type: 'command-accepted',
        commandType: 'collectStats',
        requestId: 'stats-1',
        presentation: 'not-presenting',
      }]);
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
    }
  });

  it('probes WebCodecs decode support inside the runtime worker host', async () => {
    const descriptors = {
      VideoDecoder: Object.getOwnPropertyDescriptor(globalThis, 'VideoDecoder'),
      VideoFrame: Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame'),
      EncodedVideoChunk: Object.getOwnPropertyDescriptor(globalThis, 'EncodedVideoChunk'),
      createImageBitmap: Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
    };
    class FakeVideoDecoder {
      static isConfigSupported = vi.fn(async () => ({ supported: true }));
      constructor(_init: VideoDecoderInit) {}
      close(): void {}
    }
    Object.defineProperty(globalThis, 'VideoDecoder', {
      configurable: true,
      value: FakeVideoDecoder,
    });
    Object.defineProperty(globalThis, 'VideoFrame', {
      configurable: true,
      value: class FakeVideoFrame {},
    });
    Object.defineProperty(globalThis, 'EncodedVideoChunk', {
      configurable: true,
      value: class FakeEncodedVideoChunk {},
    });
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(),
    });

    const bridge = createBridge();

    try {
      const probed = await bridge.probeCapabilities('probe-worker-webcodecs');

      expect(probed.accepted).toBe(true);
      expect(probed.commandType).toBe('probeCapabilities');
      expect(probed.capabilities).toMatchObject({
        videoDecoder: true,
        videoFrame: true,
        encodedVideoChunk: true,
        videoDecoderConfigSupport: true,
        canConstructVideoDecoder: true,
        canDecodeVideoInWorker: true,
        createImageBitmap: true,
      });
      expect(probed.statusEvents).toEqual([{
        type: 'command-accepted',
        commandType: 'probeCapabilities',
        requestId: 'probe-worker-webcodecs',
        presentation: 'not-presenting',
      }]);
    } finally {
      bridge.dispose();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
    }
  });

  it('presents a worker-owned target surface when one is attached', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;

    try {
      await bridge.initialize('worker-runtime-presenting', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      const attached = await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });
      expect(attached.statusEvents).toEqual([{
        type: 'command-accepted',
        commandType: 'attachTargetSurface',
        requestId: null,
        presentation: 'offscreen-canvas',
      }]);

      const rendered = await bridge.renderNow('render-presented-1', 'preview', 3);

      expect(canvas.getContext).toHaveBeenCalledWith('2d');
      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 320, 180);
      expect(context.fillRect).toHaveBeenCalled();
      expect(rendered.presentedFrameId).toContain('preview:render-presented-1');
      expect(rendered.statusEvents).toEqual([
        {
          type: 'command-accepted',
          commandType: 'RenderNow',
          requestId: 'render-presented-1',
          presentation: 'offscreen-canvas',
        },
        {
          type: 'frame-presented',
          requestId: 'render-presented-1',
          targetId: 'preview',
          timelineTime: 3,
        },
      ]);

      const softwareFrame = await bridge.presentSoftwareFrame('software-1', 'preview', 4, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'solid-a',
          visible: true,
          opacity: 0.5,
          compositeOperation: 'screen',
          filter: 'contrast(1.5)',
          pixelEffects: { brightness: 0 },
          geometry: {
            position: { x: 0.2, y: -0.1 },
            scale: { x: 0.5, y: 0.5 },
            rotation: Math.PI / 4,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#ff0000' },
        }],
      }, []);

      expect(context.translate).toHaveBeenCalledWith(192, 81);
      expect(context.globalCompositeOperation).toBe('screen');
      expect(context.filter).toBe('contrast(1.5)');
      expect(context.rotate).toHaveBeenCalledWith(-Math.PI / 4);
      expect(context.scale).toHaveBeenCalledWith(0.5, 0.5);
      expect(context.fillRect).toHaveBeenCalledWith(-160, -90, 320, 180);
      expect(softwareFrame.presentedFrameId).toContain('preview:software-1');
      expect(softwareFrame.statusEvents).toEqual([
        {
          type: 'command-accepted',
          commandType: 'presentSoftwareFrame',
          requestId: 'software-1',
          presentation: 'offscreen-canvas',
        },
        {
          type: 'frame-presented',
          requestId: 'software-1',
          targetId: 'preview',
          timelineTime: 4,
        },
      ]);

      const readbackFrame = await bridge.presentSoftwareFrame('software-readback-1', 'preview', 5, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'solid-readback',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#00ff00' },
        }],
      }, [], { readback: true });

      expect(context.getImageData).toHaveBeenCalledWith(0, 0, 320, 180);
      expect(readbackFrame.readback).toEqual({
        width: 320,
        height: 180,
        pixels: new Uint8ClampedArray([9, 8, 7, 6]),
      });
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
    }
  });

  it('rejects software frame presentation when initialized for worker WebGPU presentation', async () => {
    const bridge = createBridge();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;

    try {
      await bridge.initialize('worker-runtime-gpu-only', 'worker-webgpu-present');

      const softwareFrame = await bridge.presentSoftwareFrame('software-gpu-blocked', 'preview', 4, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'bitmap-gpu-blocked',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: {
            kind: 'bitmap',
            bitmap,
            width: 320,
            height: 180,
          },
        }],
      }, [bitmap as unknown as Transferable]);

      expect(bitmap.close).toHaveBeenCalledTimes(1);
      expect(softwareFrame.presentedFrameId).toBeNull();
      expect(softwareFrame.readback).toBeNull();
      expect(softwareFrame.statusEvents).toEqual([
        {
          type: 'command-accepted',
          commandType: 'presentSoftwareFrame',
          requestId: 'software-gpu-blocked',
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: 'Software frame presentation is disabled for worker WebGPU presentation',
          recoverable: false,
        },
      ]);
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
    }
  });

  it('presents a GPU-only test pattern on the worker-owned WebGPU target surface', async () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const fake = createFakeWorkerGpuSurface();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { gpu: fake.gpu },
    });
    const bridge = createBridge();

    try {
      await bridge.initialize('worker-runtime-gpu-test-pattern', 'worker-webgpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      const attached = await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas: fake.canvas,
        presentation: 'offscreen-canvas',
      });

      expect(fake.canvas.getContext).toHaveBeenCalledWith('webgpu');
      expect(fake.configure).toHaveBeenCalledWith({
        device: expect.any(Object),
        format: 'rgba8unorm',
        alphaMode: 'premultiplied',
        colorSpace: 'srgb',
      });
      expect(attached.statusEvents).toEqual([{
        type: 'command-accepted',
        commandType: 'attachTargetSurface',
        requestId: null,
        presentation: 'offscreen-canvas',
      }]);

      const rendered = await bridge.presentGpuTestPattern('gpu-pattern-1', 'preview', 1.5, 9);

      expect(fake.createCommandEncoder).toHaveBeenCalledWith({
        label: 'preview:gpu-pattern-1:gpu-clear',
      });
      expect(fake.getCurrentTexture).toHaveBeenCalledTimes(1);
      expect(fake.createView).toHaveBeenCalledTimes(1);
      expect(fake.beginRenderPass).toHaveBeenCalledWith({
        colorAttachments: [expect.objectContaining({
          view: { label: 'texture-view' },
          loadOp: 'clear',
          storeOp: 'store',
        })],
      });
      expect(fake.passEnd).toHaveBeenCalledTimes(1);
      expect(fake.finish).toHaveBeenCalledTimes(1);
      expect(fake.submit).toHaveBeenCalledWith([{ label: 'command-buffer' }]);
      expect(fake.workDone).toHaveBeenCalledTimes(1);
      expect(rendered.presentedFrameId).toBe('preview:gpu-pattern-1:gpu-clear:1');
      expect(rendered.statusEvents).toEqual([
        {
          type: 'command-accepted',
          commandType: 'gpu.presentTestPattern',
          requestId: 'gpu-pattern-1',
          presentation: 'offscreen-canvas',
        },
        {
          type: 'frame-presented',
          requestId: 'gpu-pattern-1',
          targetId: 'preview',
          timelineTime: 1.5,
        },
        {
          type: 'stats',
          requestId: 'gpu-pattern-1',
          stats: expect.objectContaining({
            'workerGpu.testPattern.frameIndex': 9,
            'workerGpu.testPattern.submitted': true,
            'workerGpu.testPattern.workDone': true,
          }),
        },
      ]);
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'navigator');
      }
    }
  });

  it('paints software frame layers bottom-first so top timeline tracks remain visible', async () => {
    const bridge = createBridge();
    const paintedFillStyles: string[] = [];
    let currentFillStyle = '';
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(() => {
        paintedFillStyles.push(currentFillStyle);
      }),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      get fillStyle() {
        return currentFillStyle;
      },
      set fillStyle(value: string) {
        currentFillStyle = value;
      },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;

    try {
      await bridge.initialize('worker-runtime-layer-order', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-layer-order-1', 'preview', 4, {
        size: { x: 320, y: 180 },
        layers: [
          {
            id: 'top-track-red',
            visible: true,
            opacity: 1,
            compositeOperation: 'source-over',
            filter: 'none',
            pixelEffects: { brightness: 0 },
            geometry: {
              position: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              rotation: 0,
              sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            source: { kind: 'solid', color: '#ff0000' },
          },
          {
            id: 'bottom-track-blue',
            visible: true,
            opacity: 1,
            compositeOperation: 'source-over',
            filter: 'none',
            pixelEffects: { brightness: 0 },
            geometry: {
              position: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              rotation: 0,
              sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            source: { kind: 'solid', color: '#0000ff' },
          },
        ],
      }, []);

      expect(paintedFillStyles).toEqual([
        '#000000',
        '#0000ff',
        '#ff0000',
      ]);
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
    }
  });

  it('applies additive worker pixel brightness before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: Uint8ClampedArray.from({ length: 320 * 180 * 4 }, (_, i) => [10, 20, 250, 255][i % 4]),
      })),
      putImageData: vi.fn(),
      fillStyle: '',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-brightness', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-brightness-1', 'preview', 6, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'solid-brightness',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0.1 },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      expect(scratchContext.fillRect).toHaveBeenCalledWith(0, 0, 320, 180);
      expect(scratchContext.getImageData).toHaveBeenCalledWith(0, 0, 320, 180);
      const writtenImageData = scratchContext.putImageData.mock.calls[0]?.[0] as ImageData | undefined;
      expect(writtenImageData?.data.slice(0, 4)).toEqual(new Uint8ClampedArray([36, 46, 255, 255]));
      expect(context.drawImage).toHaveBeenCalledWith(
        expect.any(FakeOffscreenCanvas),
        -160,
        -90,
        320,
        180,
      );
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('reuses worker-retained software bitmap sources by cache key', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;

    await bridge.initialize('worker-runtime-bitmap-cache', 'worker-cpu-present');
    await bridge.registerTarget({
      ...target,
      presentation: 'offscreen-canvas',
    });
    await bridge.attachTargetSurface({
      targetId: 'preview',
      canvas,
      presentation: 'offscreen-canvas',
    });

    const stored = await bridge.presentSoftwareFrame('software-bitmap-store', 'preview', 1, {
      size: { x: 320, y: 180 },
      layers: [{
        id: 'cached-video-a',
        visible: true,
        opacity: 1,
        compositeOperation: 'source-over',
        filter: 'none',
        pixelEffects: { brightness: 0 },
        geometry: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          sourceRect: { x: 0, y: 0, width: 1, height: 1 },
        },
        source: {
          kind: 'bitmap',
          bitmap,
          width: 384,
          height: 216,
          cacheKey: 'html-video:clip-a:30:384x216',
        },
      }],
    }, [bitmap as unknown as Transferable]);

    expect(stored.cache.bytesByOwner['source-frame']).toBe(384 * 216 * 4);
    expect(bitmap.close).not.toHaveBeenCalled();

    const reused = await bridge.presentSoftwareFrame('software-bitmap-reuse', 'preview', 1.04, {
      size: { x: 320, y: 180 },
      layers: [{
        id: 'cached-video-a',
        visible: true,
        opacity: 1,
        compositeOperation: 'source-over',
        filter: 'none',
        pixelEffects: { brightness: 0 },
        geometry: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          sourceRect: { x: 0, y: 0, width: 1, height: 1 },
        },
        source: {
          kind: 'cached-bitmap',
          cacheKey: 'html-video:clip-a:30:384x216',
          width: 384,
          height: 216,
        },
      }],
    }, []);

    const bitmapDraws = context.drawImage.mock.calls.filter((call) => call[0] === bitmap);
    expect(bitmapDraws).toHaveLength(2);
    expect(reused.cache.bytesByOwner['source-frame']).toBe(384 * 216 * 4);
    expect(bitmap.close).not.toHaveBeenCalled();

    await bridge.disposeRenderer('test cleanup');
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it('evicts old worker-retained software bitmap sources by cache key limit', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const bitmaps = Array.from({ length: WORKER_SOFTWARE_BITMAP_CACHE_ENTRY_LIMIT + 1 }, () => ({
      close: vi.fn(),
    } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> }));
    const frameBytes = 384 * 216 * 4;

    await bridge.initialize('worker-runtime-bitmap-cache-limit', 'worker-cpu-present');
    await bridge.registerTarget({
      ...target,
      presentation: 'offscreen-canvas',
    });
    await bridge.attachTargetSurface({
      targetId: 'preview',
      canvas,
      presentation: 'offscreen-canvas',
    });

    let lastResult = await bridge.collectStats('initial-cache-limit-stats');
    for (const [index, bitmap] of bitmaps.entries()) {
      lastResult = await bridge.presentSoftwareFrame(`software-bitmap-store-${index}`, 'preview', index / 30, {
        size: { x: 320, y: 180 },
        layers: [{
          id: `cached-video-${index}`,
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: {
            kind: 'bitmap',
            bitmap,
            width: 384,
            height: 216,
            cacheKey: `html-video:clip-a:${index}:384x216`,
          },
        }],
      }, [bitmap as unknown as Transferable]);
    }

    expect(lastResult.cache.bytesByOwner['source-frame']).toBe(
      WORKER_SOFTWARE_BITMAP_CACHE_ENTRY_LIMIT * frameBytes
    );
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    for (const bitmap of bitmaps.slice(1)) {
      expect(bitmap.close).not.toHaveBeenCalled();
    }

    await bridge.disposeRenderer('test cleanup');
    for (const bitmap of bitmaps) {
      expect(bitmap.close).toHaveBeenCalledTimes(1);
    }
    bridge.dispose();
  });

  it('applies worker primary color correction before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: Uint8ClampedArray.from({ length: 320 * 180 * 4 }, (_, i) => [64, 64, 64, 255][i % 4]),
      })),
      putImageData: vi.fn(),
      fillStyle: '',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-color-grade', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-color-grade-1', 'preview', 6, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'solid-color-grade',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: {
            brightness: 0,
            colorGradePrimaryNodes: [{
              ...DEFAULT_PRIMARY_COLOR_PARAMS,
              exposure: 1,
            }],
          },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      const writtenImageData = scratchContext.putImageData.mock.calls[0]?.[0] as ImageData | undefined;
      expect(writtenImageData?.data.slice(0, 4)).toEqual(new Uint8ClampedArray([128, 128, 128, 255]));
      expect(context.drawImage).toHaveBeenCalledWith(
        expect.any(FakeOffscreenCanvas),
        -160,
        -90,
        320,
        180,
      );
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('applies worker wipe transition masks before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-wipe', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-wipe-1', 'preview', 6, {
        size: { x: 320, y: 180 },
        layers: [{
          id: 'solid-wipe',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          transition: {
            kind: 'wipe',
            direction: 'right',
            progress: 0.25,
          },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      expect(scratchContext.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 320, 180);
      expect(scratchContext.save).toHaveBeenCalled();
      expect(scratchContext.globalCompositeOperation).toBe('destination-in');
      expect(scratchContext.fillStyle).toBe('#000');
      expect(scratchContext.fillRect).toHaveBeenNthCalledWith(2, 0, 0, 80, 180);
      expect(scratchContext.restore).toHaveBeenCalled();
      expect(context.drawImage).toHaveBeenCalledWith(
        expect.any(FakeOffscreenCanvas),
        -160,
        -90,
        320,
        180,
      );
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('applies worker center transition masks before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 4,
      height: 1,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([
          10, 20, 30, 255,
          40, 50, 60, 255,
          70, 80, 90, 255,
          100, 110, 120, 255,
        ]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-center-mask', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        size: { x: 4, y: 1 },
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-center-mask-1', 'preview', 6, {
        size: { x: 4, y: 1 },
        layers: [{
          id: 'solid-center-mask',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          transition: {
            kind: 'center-mask',
            axis: 'x',
            progress: 0.5,
          },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      const writtenImageData = scratchContext.putImageData.mock.calls[0]?.[0] as ImageData | undefined;
      expect(writtenImageData?.data).toEqual(new Uint8ClampedArray([
        10, 20, 30, 0,
        40, 50, 60, 255,
        70, 80, 90, 255,
        100, 110, 120, 0,
      ]));
      expect(context.drawImage).toHaveBeenCalledWith(
        expect.any(FakeOffscreenCanvas),
        -2,
        -0.5,
        4,
        1,
      );
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('applies worker mirror pixel effects before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 2,
      height: 1,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([
          1, 2, 3, 255,
          10, 20, 30, 255,
        ]),
      })),
      putImageData: vi.fn(),
      fillStyle: '',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-mirror', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        size: { x: 2, y: 1 },
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-mirror-1', 'preview', 6, {
        size: { x: 2, y: 1 },
        layers: [{
          id: 'solid-mirror',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: {
            brightness: 0,
            mirrorHorizontal: true,
            mirrorVertical: false,
          },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      const writtenImageData = scratchContext.putImageData.mock.calls[0]?.[0] as ImageData | undefined;
      expect(writtenImageData?.data).toEqual(new Uint8ClampedArray([
        1, 2, 3, 255,
        1, 2, 3, 255,
      ]));
      expect(context.drawImage).toHaveBeenCalledWith(
        expect.any(FakeOffscreenCanvas),
        -1,
        -0.5,
        2,
        1,
      );
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('applies worker pixelate effects before presenting a software layer', async () => {
    const bridge = createBridge();
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([9, 8, 7, 6]),
      })),
      putImageData: vi.fn(),
      restore: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
    };
    const canvas = {
      width: 4,
      height: 1,
      getContext: vi.fn(() => context),
    } as unknown as OffscreenCanvas;
    const scratchContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([
          1, 2, 3, 255,
          10, 20, 30, 255,
          40, 50, 60, 255,
          70, 80, 90, 255,
        ]),
      })),
      putImageData: vi.fn(),
      fillStyle: '',
    };
    class FakeOffscreenCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): typeof scratchContext {
        return scratchContext;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    try {
      await bridge.initialize('worker-runtime-pixelate', 'worker-cpu-present');
      await bridge.registerTarget({
        ...target,
        size: { x: 4, y: 1 },
        presentation: 'offscreen-canvas',
      });
      await bridge.attachTargetSurface({
        targetId: 'preview',
        canvas,
        presentation: 'offscreen-canvas',
      });

      await bridge.presentSoftwareFrame('software-pixelate-1', 'preview', 6, {
        size: { x: 4, y: 1 },
        layers: [{
          id: 'solid-pixelate',
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: {
            brightness: 0,
            pixelateSize: 2,
          },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: { kind: 'solid', color: '#000000' },
        }],
      }, []);

      const writtenImageData = scratchContext.putImageData.mock.calls[0]?.[0] as ImageData | undefined;
      expect(writtenImageData?.data).toEqual(new Uint8ClampedArray([
        1, 2, 3, 255,
        1, 2, 3, 255,
        40, 50, 60, 255,
        40, 50, 60, 255,
      ]));
    } finally {
      await bridge.disposeRenderer('test cleanup');
      bridge.dispose();
      vi.unstubAllGlobals();
    }
  });
});
