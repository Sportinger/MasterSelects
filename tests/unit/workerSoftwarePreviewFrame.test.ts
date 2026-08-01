import { describe, expect, it, vi } from 'vitest';

import {
  buildWorkerSoftwarePreviewFrame,
  hasOnlyTransientWorkerSoftwareSkips,
  hasWorkerSoftwareBlockingSkips,
} from '../../src/services/render/workerSoftwarePreviewFrame';
import {
  cacheWorkerSoftwareHtmlVideoSnapshot,
  hasCachedWorkerSoftwareHtmlVideoSnapshot,
} from '../../src/services/render/workerSoftwareHtmlVideoSnapshotCache';
import type { Layer } from '../../src/types/layers';
import { DEFAULT_PRIMARY_COLOR_PARAMS } from '../../src/types/colorCorrection';

function videoLayer(videoElement: HTMLVideoElement, mediaTime: number): Layer {
  return {
    id: 'video-a',
    name: 'Video A',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'video',
      videoElement,
      mediaTime,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function videoFrameLayer(
  videoElement: HTMLVideoElement,
  videoFrame: VideoFrame,
  mediaTime: number,
): Layer {
  return {
    ...videoLayer(videoElement, mediaTime),
    source: {
      type: 'video',
      videoElement,
      videoFrame,
      mediaTime,
    },
  };
}

function runtimeProviderLayer(
  runtimeFrame: VideoFrame | ImageBitmap,
  mediaTime: number,
  videoElement?: HTMLVideoElement,
  options: {
    readonly debugFrameTime?: number;
    readonly forceRuntimeFramePreview?: boolean;
    readonly isPlaying?: boolean;
  } = {},
): Layer {
  const debugInfo = options.debugFrameTime === undefined
    ? null
    : {
        codec: 'vp9',
        hwAccel: 'unknown',
        decodeQueueSize: 0,
        samplesLoaded: 1,
        sampleIndex: 0,
        currentFrameTimestampSeconds: options.debugFrameTime,
      };
  return {
    id: 'runtime-video-a',
    name: 'Runtime Video A',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'video',
      ...(videoElement ? { videoElement } : {}),
      mediaTime,
      ...(options.forceRuntimeFramePreview ? { forceRuntimeFramePreview: true } : {}),
      webCodecsPlayer: {
        currentTime: mediaTime,
        isPlaying: options.isPlaying ?? false,
        isFullMode: () => true,
        isSimpleMode: () => false,
        getCurrentFrame: () => runtimeFrame,
        getFrameRate: () => 30,
        getDebugInfo: vi.fn().mockReturnValue(debugInfo),
        seek: vi.fn(),
        pause: vi.fn(),
      },
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  } as Layer;
}

function solidLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'solid-a',
    name: 'Solid A',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'solid',
      color: '#ff0000',
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...overrides,
  };
}

function adjustmentLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'adjustment-a',
    name: 'Adjustment A',
    visible: true,
    opacity: 0.75,
    blendMode: 'normal',
    source: { type: 'motion-adjustment' },
    effects: [{
      id: 'adjustment-brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.2 },
    }],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...overrides,
  };
}

function createVideo(overrides: {
  readonly currentTime: number;
  readonly seeking?: boolean;
  readonly readyState?: number;
}): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: overrides.currentTime },
    readyState: { configurable: true, value: overrides.readyState ?? HTMLMediaElement.HAVE_CURRENT_DATA },
    seeking: { configurable: true, value: overrides.seeking ?? false },
    videoHeight: { configurable: true, value: 720 },
    videoWidth: { configurable: true, value: 1280 },
  });
  return video;
}

function createFakeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })),
  } as unknown as HTMLCanvasElement;
}

function installFakeOffscreenCanvas() {
  const nestedContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
  class FakeOffscreenCanvas {
    readonly width: number;
    readonly height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return nestedContext;
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
  return nestedContext;
}

describe('worker software preview frame builder', () => {
  it('preserves a supported Motion Adjustment as an accumulator layer', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [adjustmentLayer(), solidLayer()],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(2);
    expect(frame.frame.layers[0]).toMatchObject({
      id: 'adjustment-a',
      opacity: 0.75,
      source: { kind: 'adjustment' },
      pixelEffects: { brightness: 0.2 },
    });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
  });

  it('fails closed for transformed Motion Adjustment layers', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame([
      adjustmentLayer({ position: { x: 0.1, y: 0, z: 0 } }),
    ], { width: 640, height: 360 });

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-source']).toBe(1);
  });

  it('skips seeking video snapshots instead of presenting transient black scrub frames', async () => {
    const video = createVideo({ currentTime: 1, seeking: true });
    const frame = await buildWorkerSoftwarePreviewFrame([videoLayer(video, 1)], { width: 640, height: 360 });

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['video-seeking']).toBe(1);
  });

  it('skips video snapshots that are far from the requested media time', async () => {
    const video = createVideo({ currentTime: 1 });
    const frame = await buildWorkerSoftwarePreviewFrame([videoLayer(video, 4)], { width: 640, height: 360 });

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(1);
  });

  it('allows the scrub path to present drifted paused video snapshots within the drag tolerance', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 1.3 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1)],
        { width: 640, height: 360 },
        { videoSnapshotMaxDriftSeconds: 0.35 },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('can hold html video snapshots during active scrub', async () => {
    const video = createVideo({ currentTime: 1 });
    const frame = await buildWorkerSoftwarePreviewFrame(
      [videoLayer(video, 1)],
      { width: 640, height: 360 },
      { allowHtmlVideoSnapshots: false },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['scrub-hold']).toBe(1);
  });

  it('keeps near-target video snapshots presentable', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 1.04 });
      const frame = await buildWorkerSoftwarePreviewFrame([videoLayer(video, 1)], { width: 640, height: 360 });

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.presentableLayerCount).toBe(1);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('downscales html video snapshots to the configured preview bounds', async () => {
    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1)],
        { width: 640, height: 360 },
        {
          maxBitmapSnapshotSize: { width: 320, height: 320 },
          bitmapSnapshotResizeQuality: 'low',
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video, {
        resizeWidth: 320,
        resizeHeight: 180,
        resizeQuality: 'low',
      });
      expect(frame.frame.layers[0]?.source).toMatchObject({
        kind: 'bitmap',
        bitmap,
        width: 320,
        height: 180,
      });
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('falls back to full-size html video snapshots when resize options are unsupported', async () => {
    const bitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockRejectedValueOnce(new Error('resize unsupported'))
        .mockResolvedValueOnce(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1)],
        { width: 640, height: 360 },
        { maxBitmapSnapshotSize: { width: 320, height: 320 } },
      );

      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(1, video, {
        resizeWidth: 320,
        resizeHeight: 180,
        resizeQuality: 'medium',
      });
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(2, video);
      expect(frame.frame.layers[0]?.source).toMatchObject({
        kind: 'bitmap',
        bitmap,
        width: 1280,
        height: 720,
      });
      expect(frame.diagnostics.skippedLayerCount).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('uses a cached html video snapshot during transient scrub seeks', async () => {
    const stableBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const cachedBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const drawImage = vi.fn();
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage,
      })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvas
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(stableBitmap)
        .mockResolvedValueOnce(cachedBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        { cacheHtmlVideoSnapshots: true },
      );

      expect(first.frame.layers).toHaveLength(1);
      expect(drawImage).toHaveBeenCalledWith(stableBitmap, 0, 0, 1280, 720);

      Object.defineProperties(video, {
        currentTime: { configurable: true, value: 3 },
        seeking: { configurable: true, value: true },
      });
      const held = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 3)],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenLastCalledWith(fakeCanvas);
      expect(held.frame.layers).toHaveLength(1);
      expect(held.frame.layers[0]?.source).toMatchObject({ kind: 'bitmap', bitmap: cachedBitmap });
      expect(held.diagnostics.skippedByReason['video-seeking']).toBe(0);
      expect(held.diagnostics.skippedLayerCount).toBe(0);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('reuses nearby cached html video snapshots during active scrub', async () => {
    const stableBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const cachedBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const freshBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvas
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(stableBitmap)
        .mockResolvedValueOnce(cachedBitmap)
        .mockResolvedValueOnce(freshBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const first = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1)],
        { width: 640, height: 360 },
        { cacheHtmlVideoSnapshots: true },
      );

      expect(first.frame.layers).toHaveLength(1);
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(1, video);

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.08 });
      const near = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1.08)],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.12,
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(2, fakeCanvas);
      expect(near.frame.layers[0]?.source).toMatchObject({ kind: 'bitmap', bitmap: cachedBitmap });

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.3 });
      const outsideDrift = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1.3)],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.12,
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(3, video);
      expect(outsideDrift.frame.layers[0]?.source).toMatchObject({ kind: 'bitmap', bitmap: freshBitmap });
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('does not recache identical html video snapshots unless a larger pause snapshot is needed', async () => {
    const smallBitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const fullBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvas
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(smallBitmap)
        .mockResolvedValueOnce(fullBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const smallMaxSize = { width: 320, height: 180 };

      await expect(cacheWorkerSoftwareHtmlVideoSnapshot({
        video,
        mediaTime: 1,
        ownerId: 'clip-a',
        maxSize: smallMaxSize,
        resizeQuality: 'medium',
      })).resolves.toBe(true);

      expect(hasCachedWorkerSoftwareHtmlVideoSnapshot({
        video,
        mediaTime: 1,
        ownerId: 'clip-a',
        maxSize: smallMaxSize,
      })).toBe(true);
      await expect(cacheWorkerSoftwareHtmlVideoSnapshot({
        video,
        mediaTime: 1,
        ownerId: 'clip-a',
        maxSize: smallMaxSize,
        resizeQuality: 'medium',
        skipIfCached: true,
      })).resolves.toBe(false);
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);

      await expect(cacheWorkerSoftwareHtmlVideoSnapshot({
        video,
        mediaTime: 1,
        ownerId: 'clip-a',
      })).resolves.toBe(true);
      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
      expect(globalThis.createImageBitmap).toHaveBeenLastCalledWith(video);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('captures fresh html video frames before nearby cached snapshots during playback', async () => {
    const initialBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const freshBitmap = { width: 1280, height: 720, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvas
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(initialBitmap)
        .mockResolvedValueOnce(freshBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        { cacheHtmlVideoSnapshots: true },
      );

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.08 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.08 } }],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.12,
          preferCachedVideoSnapshots: false,
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(1, video);
      expect(globalThis.createImageBitmap).toHaveBeenNthCalledWith(2, video);
      expect(frame.frame.layers[0]?.source).toMatchObject({ kind: 'bitmap', bitmap: freshBitmap });
      expect(frame.diagnostics.skippedLayerCount).toBe(0);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('emits worker cached-bitmap references for known nearby scrub snapshots', async () => {
    const stableBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      })),
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvas
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(stableBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const cacheKey = first.frame.layers[0]?.source.kind === 'bitmap'
        ? first.frame.layers[0].source.cacheKey
        : undefined;
      expect(cacheKey).toBe('html-video:clip-a:30:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.08 });
      const reused = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.08 } }],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.12,
          workerBitmapCacheKeys: new Set([cacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(reused.frame.layers[0]?.source).toMatchObject({
        kind: 'cached-bitmap',
        cacheKey,
        width: 384,
        height: 216,
      });
      expect(reused.transfer).toEqual([]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('reuses a cached worker bitmap while the HTML video frame key is unchanged', async () => {
    const stableBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? createFakeCanvas()
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(stableBitmap),
    });
    try {
      const quality = { totalVideoFrames: 42 };
      const video = createVideo({ currentTime: 1 });
      Object.defineProperty(video, 'getVideoPlaybackQuality', {
        configurable: true,
        value: () => quality,
      });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const cacheKey = first.frame.layers[0]?.source.kind === 'bitmap'
        ? first.frame.layers[0].source.cacheKey
        : undefined;
      expect(cacheKey).toBe('html-video:clip-a:30:vf42:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.01 });
      const reused = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.01 } }],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set([cacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
      expect(reused.frame.layers[0]?.source).toMatchObject({
        kind: 'cached-bitmap',
        cacheKey,
        width: 384,
        height: 216,
      });
      expect(reused.transfer).toEqual([]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('captures a fresh worker bitmap when the HTML video frame id advances', async () => {
    const firstBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const secondBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? createFakeCanvas()
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(firstBitmap)
        .mockResolvedValueOnce(secondBitmap),
    });
    try {
      const quality = { totalVideoFrames: 42 };
      const video = createVideo({ currentTime: 1 });
      Object.defineProperty(video, 'getVideoPlaybackQuality', {
        configurable: true,
        value: () => quality,
      });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const firstCacheKey = first.frame.layers[0]?.source.kind === 'bitmap'
        ? first.frame.layers[0].source.cacheKey
        : undefined;
      expect(firstCacheKey).toBe('html-video:clip-a:30:vf42:384x216');

      quality.totalVideoFrames = 43;
      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.01 });
      const second = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.01 } }],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set([firstCacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const secondCacheKey = second.frame.layers[0]?.source.kind === 'bitmap'
        ? second.frame.layers[0].source.cacheKey
        : undefined;

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
      expect(secondCacheKey).toBe('html-video:clip-a:30:vf43:384x216');
      expect(second.transfer).toEqual([secondBitmap]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('captures a fresh worker bitmap when media time advances despite a stale HTML video frame id', async () => {
    const firstBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const secondBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? createFakeCanvas()
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement);
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(firstBitmap)
        .mockResolvedValueOnce(secondBitmap),
    });
    try {
      const quality = { totalVideoFrames: 42 };
      const video = createVideo({ currentTime: 1 });
      Object.defineProperty(video, 'getVideoPlaybackQuality', {
        configurable: true,
        value: () => quality,
      });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const firstCacheKey = first.frame.layers[0]?.source.kind === 'bitmap'
        ? first.frame.layers[0].source.cacheKey
        : undefined;
      expect(firstCacheKey).toBe('html-video:clip-a:30:vf42:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.04 });
      const second = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.04 } }],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set([firstCacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const secondCacheKey = second.frame.layers[0]?.source.kind === 'bitmap'
        ? second.frame.layers[0].source.cacheKey
        : undefined;

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
      expect(secondCacheKey).toBe('html-video:clip-a:31:vf42:384x216');
      expect(second.transfer).toEqual([secondBitmap]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('prefers owner-specific cached html snapshots over newer ownerless snapshots', async () => {
    const firstBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const secondBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvases = [
      {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        })),
      },
      {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        })),
      },
    ] as unknown as HTMLCanvasElement[];
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvases.shift() ?? originalCreateElement(tagName, options)
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(firstBitmap)
        .mockResolvedValueOnce(secondBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const ownerLayer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const ownerFrame = await buildWorkerSoftwarePreviewFrame(
        [ownerLayer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const ownerCacheKey = ownerFrame.frame.layers[0]?.source.kind === 'bitmap'
        ? ownerFrame.frame.layers[0].source.cacheKey
        : undefined;
      expect(ownerCacheKey).toBe('html-video:clip-a:30:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.08 });
      await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1.08)],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );

      const reused = await buildWorkerSoftwarePreviewFrame(
        [{ ...ownerLayer, source: { ...ownerLayer.source!, mediaTime: 1.08 } }],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.12,
          workerBitmapCacheKeys: new Set([ownerCacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
      expect(reused.frame.layers[0]?.source).toMatchObject({
        kind: 'cached-bitmap',
        cacheKey: ownerCacheKey,
        width: 384,
        height: 216,
      });
      expect(reused.transfer).toEqual([]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('retains multiple cached html video snapshots for back-and-forth scrubbing', async () => {
    const firstBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const secondBitmap = { width: 384, height: 216, close: vi.fn() } as unknown as ImageBitmap;
    const fakeCanvases = [
      {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        })),
      },
      {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          clearRect: vi.fn(),
          drawImage: vi.fn(),
        })),
      },
    ] as unknown as HTMLCanvasElement[];
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((((
      tagName: string,
      options?: ElementCreationOptions,
    ) => (
      tagName === 'canvas'
        ? fakeCanvases.shift() ?? originalCreateElement(tagName, options)
        : originalCreateElement(tagName, options)
    )) as typeof document.createElement));
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn()
        .mockResolvedValueOnce(firstBitmap)
        .mockResolvedValueOnce(secondBitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const layer = { ...videoLayer(video, 1), sourceClipId: 'clip-a' };
      const first = await buildWorkerSoftwarePreviewFrame(
        [layer],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const firstCacheKey = first.frame.layers[0]?.source.kind === 'bitmap'
        ? first.frame.layers[0].source.cacheKey
        : undefined;
      expect(firstCacheKey).toBe('html-video:clip-a:30:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 2 });
      const second = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 2 } }],
        { width: 640, height: 360 },
        {
          cacheHtmlVideoSnapshots: true,
          workerBitmapCacheKeys: new Set(),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );
      const secondCacheKey = second.frame.layers[0]?.source.kind === 'bitmap'
        ? second.frame.layers[0].source.cacheKey
        : undefined;
      expect(secondCacheKey).toBe('html-video:clip-a:60:384x216');

      Object.defineProperty(video, 'currentTime', { configurable: true, value: 1.04 });
      const reusedFirst = await buildWorkerSoftwarePreviewFrame(
        [{ ...layer, source: { ...layer.source!, mediaTime: 1.04 } }],
        { width: 640, height: 360 },
        {
          allowCachedVideoSnapshots: true,
          cacheHtmlVideoSnapshots: true,
          cachedVideoSnapshotMaxDriftSeconds: 0.08,
          workerBitmapCacheKeys: new Set([firstCacheKey ?? 'missing']),
          maxBitmapSnapshotSize: { width: 384, height: 216 },
        },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
      expect(reusedFirst.frame.layers[0]?.source).toMatchObject({
        kind: 'cached-bitmap',
        cacheKey: firstCacheKey,
        width: 384,
        height: 216,
      });
      expect(reusedFirst.transfer).toEqual([]);
    } finally {
      createElementSpy.mockRestore();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('prefers a decoded video frame over a stale html video element', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const videoFrame = {
      codedWidth: 1280,
      codedHeight: 720,
    } as VideoFrame;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const staleVideo = createVideo({ currentTime: 1 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoFrameLayer(staleVideo, videoFrame, 4)],
        { width: 640, height: 360 },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(videoFrame);
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.presentableLayerCount).toBe(1);
      expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('falls back to the html video element when a decoded video frame placeholder is empty', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const emptyVideoFrame = {
      codedWidth: 0,
      codedHeight: 0,
    } as VideoFrame;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 4 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoFrameLayer(video, emptyVideoFrame, 4)],
        { width: 640, height: 360 },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(video);
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.presentableLayerCount).toBe(1);
      expect(frame.diagnostics.skippedByReason['empty-video-frame']).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('prefers a runtime provider frame over a seeking html video snapshot', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const runtimeFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const seekingVideo = createVideo({ currentTime: 0, seeking: true });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [runtimeProviderLayer(runtimeFrame, 1, seekingVideo)],
        { width: 640, height: 360 },
      );

      expect(globalThis.createImageBitmap).toHaveBeenCalledWith(runtimeFrame);
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.presentableLayerCount).toBe(1);
      expect(frame.diagnostics.skippedByReason['video-seeking']).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('reports html video snapshot layers separately from webcodecs layers', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const video = createVideo({ currentTime: 1 });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [videoLayer(video, 1)],
        { width: 640, height: 360 },
      );

      expect(frame.diagnostics.htmlVideoLayerCount).toBe(1);
      expect(frame.diagnostics.webCodecsLayerCount).toBe(0);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('reports runtime provider video frames as webcodecs layers for stats truth', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const runtimeFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const htmlVideo = createVideo({ currentTime: 1, seeking: true });
      const frame = await buildWorkerSoftwarePreviewFrame(
        [runtimeProviderLayer(runtimeFrame, 1, htmlVideo)],
        { width: 640, height: 360 },
      );

      expect(frame.diagnostics.htmlVideoLayerCount).toBe(0);
      expect(frame.diagnostics.webCodecsLayerCount).toBe(1);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('does not fall back to html snapshots for forced runtime frame preview', async () => {
    const htmlVideo = createVideo({ currentTime: 1 });
    const layer = {
      ...videoLayer(htmlVideo, 1),
      source: {
        type: 'video',
        videoElement: htmlVideo,
        mediaTime: 1,
        forceRuntimeFramePreview: true,
      },
    } as Layer;

    const frame = await buildWorkerSoftwarePreviewFrame(
      [layer],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.htmlVideoLayerCount).toBe(0);
    expect(frame.diagnostics.webCodecsLayerCount).toBe(0);
    expect(frame.diagnostics.forcedRuntimeFrameLayerCount).toBe(1);
    expect(frame.diagnostics.skippedByReason['runtime-frame-missing']).toBe(1);
  });

  it('blocks stale runtime provider frames when no html snapshot can cover the scrub target', async () => {
    const staleRuntimeFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;
    const frame = await buildWorkerSoftwarePreviewFrame(
      [runtimeProviderLayer(staleRuntimeFrame, 4)],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });

  it('blocks playing runtime provider frames that drift beyond playback tolerance', async () => {
    const staleRuntimeFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;
    const frame = await buildWorkerSoftwarePreviewFrame(
      [runtimeProviderLayer(staleRuntimeFrame, 1.4, undefined, { isPlaying: true })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(1);
    expect(frame.diagnostics.maxVideoDriftMs).toBeCloseTo(400, 1);
  });

  it('accepts forced runtime playback frames across the reverse intermediate-frame window', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const reverseRuntimeFrame = {
      codedWidth: 1280,
      codedHeight: 720,
      displayWidth: 1280,
      displayHeight: 720,
      timestamp: 1_000_000,
    } as VideoFrame;
    try {
      const frame = await buildWorkerSoftwarePreviewFrame(
        [
          runtimeProviderLayer(reverseRuntimeFrame, 1.8, undefined, {
            forceRuntimeFramePreview: true,
            isPlaying: true,
          }),
        ],
        { width: 640, height: 360 },
      );

      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.diagnostics.webCodecsLayerCount).toBe(1);
      expect(frame.diagnostics.htmlVideoLayerCount).toBe(0);
      expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(0);
      expect(frame.diagnostics.maxVideoDriftMs).toBeCloseTo(800, 1);
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('uses provider debug timestamps to reject stale ImageBitmap runtime frames', async () => {
    const staleRuntimeBitmap = {
      width: 1280,
      height: 720,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const frame = await buildWorkerSoftwarePreviewFrame(
      [runtimeProviderLayer(staleRuntimeBitmap, 1.4, undefined, { debugFrameTime: 1, isPlaying: true })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['video-time-drift']).toBe(1);
    expect(frame.diagnostics.maxVideoDriftMs).toBeCloseTo(400, 1);
  });

  it('treats camera control layers as non-rendering worker software sources', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [
        solidLayer(),
        solidLayer({
          id: 'camera-control',
          source: {
            type: 'camera',
            cameraSettings: { fov: 60, near: 0.1, far: 1000 },
          },
        }),
      ],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.diagnostics.skippedByReason['non-rendering-source']).toBe(1);
    expect(frame.diagnostics.skippedLayerCount).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
    expect(hasOnlyTransientWorkerSoftwareSkips(frame.diagnostics)).toBe(false);
  });

  it('carries supported blend modes into worker software layers', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({ blendMode: 'screen' })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.compositeOperation).toBe('screen');
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({ brightness: 0 });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('blocks unsupported blend modes instead of silently presenting wrong pixels', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({ blendMode: 'subtract' })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-blend-mode']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });

  it('carries supported effects into worker software filters', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'blur-a',
            type: 'blur',
            name: 'Blur',
            enabled: true,
            params: { radius: 6 },
          },
          {
            id: 'contrast-a',
            type: 'contrast',
            name: 'Contrast',
            enabled: true,
            params: { amount: 1.5 },
          },
          {
            id: 'saturation-a',
            type: 'saturation',
            name: 'Saturation',
            enabled: true,
            params: { amount: 0.8 },
          },
          {
            id: 'hue-a',
            type: 'hue-shift',
            name: 'Hue Shift',
            enabled: true,
            params: { shift: 0.25 },
          },
          {
            id: 'invert-a',
            type: 'invert',
            name: 'Invert',
            enabled: true,
            params: {},
          },
        ],
      })],
      { width: 640, height: 360 },
    );

      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.frame.layers[0]?.filter).toBe('blur(6px) contrast(1.5) saturate(0.8) hue-rotate(90deg) invert(1)');
      expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({ brightness: 0 });
      expect(frame.diagnostics.skippedLayerCount).toBe(0);
      expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
    });

  it('keeps canvas-compatible registry blur effects on the worker software path', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'gaussian-blur-a',
            type: 'gaussian-blur',
            name: 'Gaussian Blur',
            enabled: true,
            params: { radius: 8, samples: 9 },
          },
          {
            id: 'box-blur-a',
            type: 'box-blur',
            name: 'Box Blur',
            enabled: true,
            params: { radius: 3 },
          },
        ] as Layer['effects'],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('blur(8px) blur(3px)');
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries additive brightness into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'brightness-a',
          type: 'brightness',
          name: 'Brightness',
          enabled: true,
          params: { amount: 0.2 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({ brightness: 0.2 });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries exposure into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'exposure-a',
          type: 'exposure',
          name: 'Exposure',
          enabled: true,
          params: { exposure: 1.25, offset: 0.05, gamma: 1.4 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      exposureAdjustments: [{ exposure: 1.25, offset: 0.05, gamma: 1.4 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries temperature and vibrance into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'temperature-a',
            type: 'temperature',
            name: 'Temperature',
            enabled: true,
            params: { temperature: 0.75, tint: -0.25 },
          },
          {
            id: 'vibrance-a',
            type: 'vibrance',
            name: 'Vibrance',
            enabled: true,
            params: { amount: 0.4 },
          },
        ],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      temperatureAdjustments: [{ temperature: 0.75, tint: -0.25 }],
      vibranceAdjustments: [{ amount: 0.4 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries levels, threshold, posterize, and vignette into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'levels-a',
            type: 'levels',
            name: 'Levels',
            enabled: true,
            params: {
              inputBlack: 0.1,
              inputWhite: 0.9,
              gamma: 1.2,
              outputBlack: 0.05,
              outputWhite: 0.95,
            },
          },
          {
            id: 'threshold-a',
            type: 'threshold',
            name: 'Threshold',
            enabled: true,
            params: { level: 0.45 },
          },
          {
            id: 'posterize-a',
            type: 'posterize',
            name: 'Posterize',
            enabled: true,
            params: { levels: 5 },
          },
          {
            id: 'vignette-a',
            type: 'vignette',
            name: 'Vignette',
            enabled: true,
            params: { amount: 0.6, size: 0.45, softness: 0.25, roundness: 1.2 },
          },
        ],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      levelsAdjustments: [{
        inputBlack: 0.1,
        inputWhite: 0.9,
        gamma: 1.2,
        outputBlack: 0.05,
        outputWhite: 0.95,
      }],
      thresholdAdjustments: [{ level: 0.45 }],
      posterizeAdjustments: [{ levels: 5 }],
      vignetteAdjustments: [{ amount: 0.6, size: 0.45, softness: 0.25, roundness: 1.2 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries chroma key into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'chroma-key-a',
          type: 'chroma-key',
          name: 'Chroma Key',
          enabled: true,
          params: { keyColor: 'green', tolerance: 0.2, softness: 0.1, spillSuppression: 0.5 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      chromaKeyAdjustments: [{
        keyColor: 'green',
        tolerance: 0.2,
        softness: 0.1,
        spillSuppression: 0.5,
      }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries edge detect into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'edge-detect-a',
          type: 'edge-detect',
          name: 'Edge Detect',
          enabled: true,
          params: { strength: 0.2, invert: false },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      edgeDetectAdjustments: [{ strength: 0.2, invert: false }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries sharpen into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'sharpen-a',
          type: 'sharpen',
          name: 'Sharpen',
          enabled: true,
          params: { amount: 1.4, radius: 1.5 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      sharpenAdjustments: [{ amount: 1.4, radius: 1.5 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries glow into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'glow-a',
          type: 'glow',
          name: 'Glow',
          enabled: true,
          params: {
            amount: 0.6,
            threshold: 0.35,
            radius: 2,
            softness: 0.7,
            rings: 2,
            samplesPerRing: 8,
          },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      glowAdjustments: [{
        amount: 0.6,
        threshold: 0.35,
        radius: 2,
        softness: 0.7,
        rings: 2,
        samplesPerRing: 8,
      }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries scanlines and grain into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'scanlines-a',
            type: 'scanlines',
            name: 'Scanlines',
            enabled: true,
            params: { density: 5, opacity: 0.25, speed: 2 },
          },
          {
            id: 'grain-a',
            type: 'grain',
            name: 'Film Grain',
            enabled: true,
            params: { amount: 0.1, size: 1.5, speed: 1.25 },
          },
        ],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      scanlineAdjustments: [{ density: 5, opacity: 0.25, speed: 2 }],
      grainAdjustments: [{ amount: 0.1, size: 1.5, speed: 1.25 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries wave distortion into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'wave-a',
          type: 'wave',
          name: 'Wave',
          enabled: true,
          params: { amplitudeX: 0.01, amplitudeY: 0.02, frequencyX: 4, frequencyY: 6 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      waveAdjustments: [{ amplitudeX: 0.01, amplitudeY: 0.02, frequencyX: 4, frequencyY: 6 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries kaleidoscope distortion into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'kaleidoscope-a',
          type: 'kaleidoscope',
          name: 'Kaleidoscope',
          enabled: true,
          params: { segments: 8, rotation: 0.25 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      kaleidoscopeAdjustments: [{ segments: 8, rotation: 0.25 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries motion blur into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'motion-blur-a',
          type: 'motion-blur',
          name: 'Motion Blur',
          enabled: true,
          params: { amount: 0.08, angle: 0.4, samples: 12 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      motionBlurAdjustments: [{ amount: 0.08, angle: 0.4, samples: 12 }],
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries radial and zoom blur into worker software pixel effects', async () => {
    const radialFrame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'radial-blur-a',
          type: 'radial-blur',
          name: 'Radial Blur',
          enabled: true,
          params: { amount: 0.75, centerX: 0.45, centerY: 0.55, samples: 20 },
        }],
      })],
      { width: 640, height: 360 },
    );
    const zoomFrame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'zoom-blur-a',
          type: 'zoom-blur',
          name: 'Zoom Blur',
          enabled: true,
          params: { amount: 0.4, centerX: 0.5, centerY: 0.45, samples: 18 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(radialFrame.frame.layers[0]?.pixelEffects).toMatchObject({
      radialBlurAdjustments: [{ amount: 0.75, centerX: 0.45, centerY: 0.55, samples: 20 }],
    });
    expect(radialFrame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(radialFrame.diagnostics)).toBe(false);
    expect(zoomFrame.frame.layers[0]?.pixelEffects).toMatchObject({
      zoomBlurAdjustments: [{ amount: 0.4, centerX: 0.5, centerY: 0.45, samples: 18 }],
    });
    expect(zoomFrame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(zoomFrame.diagnostics)).toBe(false);
  });

  it('carries standalone acuarela and rom1 into worker software feedback effects', async () => {
    const acuarelaFrame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'acuarela-a',
          type: 'acuarela',
          name: 'Acuarela',
          enabled: true,
          params: {
            opacity: 0.8,
            gain: 0.02,
            speed: 3,
            detail: 2,
            strength: 0.25,
            density: 6,
            gainX: 0.2,
            gainY: 0.4,
          },
        }],
      })],
      { width: 640, height: 360 },
    );
    const rom1Frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'rom1-a',
          type: 'rom1',
          name: 'Rom1',
          enabled: true,
          params: { opacity: 0.7, gain: 0.03, speed: 2, detail: 3, strength: 0.2, density: 5 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(acuarelaFrame.frame.layers[0]?.pixelEffects).toMatchObject({
      acuarelaAdjustments: [{
        feedbackKey: 'solid-a:acuarela-a',
        opacity: 0.8,
        gain: 0.02,
        speed: 3,
        detail: 2,
        strength: 0.25,
        density: 6,
        gainX: 0.2,
        gainY: 0.4,
        reset: false,
      }],
    });
    expect(acuarelaFrame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(acuarelaFrame.diagnostics)).toBe(false);
    expect(rom1Frame.frame.layers[0]?.pixelEffects).toMatchObject({
      rom1Adjustments: [{
        feedbackKey: 'solid-a:rom1-a',
        opacity: 0.7,
        gain: 0.03,
        speed: 2,
        detail: 3,
        strength: 0.2,
        density: 5,
        gainX: 0.3,
        gainY: 0.3,
        reset: false,
      }],
    });
    expect(rom1Frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(rom1Frame.diagnostics)).toBe(false);
  });

  it('carries twirl and bulge distortions into worker software pixel effects', async () => {
    const twirlFrame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'twirl-a',
          type: 'twirl',
          name: 'Twirl',
          enabled: true,
          params: { amount: 1.2, radius: 0.75, centerX: 0.5, centerY: 0.45 },
        }],
      })],
      { width: 640, height: 360 },
    );
    const bulgeFrame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'bulge-a',
          type: 'bulge',
          name: 'Bulge',
          enabled: true,
          params: { amount: 1.4, radius: 0.6, centerX: 0.55, centerY: 0.5 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(twirlFrame.frame.layers[0]?.pixelEffects).toMatchObject({
      twirlAdjustments: [{ amount: 1.2, radius: 0.75, centerX: 0.5, centerY: 0.45 }],
    });
    expect(twirlFrame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(twirlFrame.diagnostics)).toBe(false);
    expect(bulgeFrame.frame.layers[0]?.pixelEffects).toMatchObject({
      bulgeAdjustments: [{ amount: 1.4, radius: 0.6, centerX: 0.55, centerY: 0.5 }],
    });
    expect(bulgeFrame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(bulgeFrame.diagnostics)).toBe(false);
  });

  it('blocks stacked source-resampling effects until worker multi-pass effects exist', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'wave-a',
            type: 'wave',
            name: 'Wave',
            enabled: true,
            params: { amplitudeX: 0.01, amplitudeY: 0.02, frequencyX: 4, frequencyY: 6 },
          },
          {
            id: 'twirl-a',
            type: 'twirl',
            name: 'Twirl',
            enabled: true,
            params: { amount: 1, radius: 0.5, centerX: 0.5, centerY: 0.5 },
          },
        ],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });

  it('blocks stacked feedback effects until worker multi-pass feedback exists', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [
          {
            id: 'acuarela-a',
            type: 'acuarela',
            name: 'Acuarela',
            enabled: true,
            params: {},
          },
          {
            id: 'brightness-a',
            type: 'brightness',
            name: 'Brightness',
            enabled: true,
            params: { amount: 0.1 },
          },
        ],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });

  it('carries runtime primary color correction into worker software pixel effects', async () => {
    const primary = {
      ...DEFAULT_PRIMARY_COLOR_PARAMS,
      exposure: 1,
      contrast: 1.2,
      saturation: 0.8,
    };
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        colorCorrection: {
          enabled: true,
          graphHash: 'grade-a',
          nodeIds: ['primary-a'],
          primary,
          primaryNodes: [primary],
          diagnostics: [],
        },
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.pixelEffects.colorGradePrimaryNodes).toEqual([primary]);
    expect(frame.diagnostics.skippedByReason['unsupported-color-correction']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries simple wipe transitions into worker software layers', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        transitionRender: {
          kind: 'wipe',
          direction: 'left',
          progress: 0.4,
        },
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.transition).toEqual({
      kind: 'wipe',
      direction: 'left',
      progress: 0.4,
    });
    expect(frame.diagnostics.skippedByReason['unsupported-transition']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries compositor mask transitions into worker software layers', async () => {
    const cases = [
      {
        kind: 'shape-mask',
        shape: 'circle',
        progress: 0.4,
      },
      {
        kind: 'center-mask',
        axis: 'x',
        progress: 0.5,
      },
      {
        kind: 'clock-mask',
        progress: 0.6,
        clockwise: true,
        angleOffset: 0,
      },
      {
        kind: 'procedural-mask',
        procedural: 'noise',
        progress: 0.7,
        seed: 12,
      },
      {
        kind: 'pattern-mask',
        pattern: 'checker',
        progress: 0.8,
      },
    ] as const;

    for (const transitionRender of cases) {
      const frame = await buildWorkerSoftwarePreviewFrame(
        [solidLayer({ transitionRender })],
        { width: 640, height: 360 },
      );

      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.frame.layers[0]?.transition).toMatchObject({
        kind: transitionRender.kind,
        progress: transitionRender.progress,
      });
      expect(frame.diagnostics.skippedByReason['unsupported-transition']).toBe(0);
      expect(frame.diagnostics.skippedLayerCount).toBe(0);
      expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
    }
  });

  it('blocks transition distortions until worker software can match compositor pixels', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        transitionRender: {
          kind: 'distortion',
          distortion: 'swirl',
          progress: 0.4,
          seed: 12,
        },
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-transition']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });

  it('carries mirror into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'mirror-a',
          type: 'mirror',
          name: 'Mirror',
          enabled: true,
          params: { horizontal: true, vertical: true },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      brightness: 0,
      mirrorHorizontal: true,
      mirrorVertical: true,
    });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('uses horizontal mirror by default to match the effect registry', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'mirror-a',
          type: 'mirror',
          name: 'Mirror',
          enabled: true,
          params: {},
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      mirrorHorizontal: true,
      mirrorVertical: false,
    });
  });

  it('carries pixelate into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'pixelate-a',
          type: 'pixelate',
          name: 'Pixelate',
          enabled: true,
          params: { size: 12 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      brightness: 0,
      pixelateSize: 12,
    });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('carries rgb-split into worker software pixel effects', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'rgb-split-a',
          type: 'rgb-split',
          name: 'RGB Split',
          enabled: true,
          params: { amount: 0.04, angle: Math.PI / 2 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({
      brightness: 0,
      rgbSplit: { amount: 0.04, angle: Math.PI / 2 },
    });
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(0);
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
  });

  it('rasterizes supported nested compositions into worker bitmap layers', async () => {
    const nestedContext = installFakeOffscreenCanvas();
    const bitmap = { width: 320, height: 180, close: vi.fn() } as unknown as ImageBitmap;
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    try {
      const frame = await buildWorkerSoftwarePreviewFrame(
        [solidLayer({
          id: 'nested-parent',
          name: 'Nested Parent',
          source: {
            type: 'image',
            nestedComposition: {
              compositionId: 'comp-nested-a',
              width: 320,
              height: 180,
              currentTime: 1,
              layers: [solidLayer({ id: 'nested-child' })],
            },
          },
        })],
        { width: 640, height: 360 },
      );

      expect(nestedContext.fillRect).toHaveBeenCalled();
      expect(globalThis.createImageBitmap).toHaveBeenCalled();
      expect(frame.frame.layers).toHaveLength(1);
      expect(frame.frame.layers[0]?.source).toMatchObject({
        kind: 'bitmap',
        bitmap,
        width: 320,
        height: 180,
      });
      expect(frame.diagnostics.skippedByReason['unsupported-nested-composition']).toBe(0);
      expect(frame.diagnostics.skippedLayerCount).toBe(0);
      expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('blocks nested compositions when their child layers are not worker-presentable', async () => {
    installFakeOffscreenCanvas();
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(),
    });
    try {
      const frame = await buildWorkerSoftwarePreviewFrame(
        [solidLayer({
          id: 'nested-parent-unsupported',
          name: 'Nested Parent Unsupported',
          source: {
            type: 'image',
            nestedComposition: {
              compositionId: 'comp-nested-unsupported',
              width: 320,
              height: 180,
              currentTime: 1,
              layers: [solidLayer({
                id: 'nested-child-unsupported',
                effects: [{
                  id: 'effect-a',
                  type: 'voxel-relief',
                  name: 'Voxel Relief',
                  enabled: true,
                  params: {},
                }],
              })],
            },
          },
        })],
        { width: 640, height: 360 },
      );

      expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
      expect(frame.frame.layers).toHaveLength(0);
      expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(1);
      expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      if (originalCreateImageBitmap) {
        Object.defineProperty(globalThis, 'createImageBitmap', {
          configurable: true,
          value: originalCreateImageBitmap,
        });
      } else {
        Reflect.deleteProperty(globalThis, 'createImageBitmap');
      }
    }
  });

  it('ignores audio effects for worker software visual presentation', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'audio-volume-a',
          type: 'audio-volume',
          name: 'Volume',
          enabled: true,
          params: { volume: 0.5 },
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(1);
    expect(frame.frame.layers[0]?.filter).toBe('none');
    expect(frame.frame.layers[0]?.pixelEffects).toMatchObject({ brightness: 0 });
    expect(frame.diagnostics.skippedLayerCount).toBe(0);
  });

  it('blocks unsupported active effects until the worker software presenter can apply them correctly', async () => {
    const frame = await buildWorkerSoftwarePreviewFrame(
      [solidLayer({
        effects: [{
          id: 'effect-a',
          type: 'voxel-relief',
          name: 'Voxel Relief',
          enabled: true,
          params: {},
        }],
      })],
      { width: 640, height: 360 },
    );

    expect(frame.frame.layers).toHaveLength(0);
    expect(frame.diagnostics.skippedByReason['unsupported-effects']).toBe(1);
    expect(hasWorkerSoftwareBlockingSkips(frame.diagnostics)).toBe(true);
  });
});
