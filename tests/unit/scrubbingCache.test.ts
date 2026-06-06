import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrubbingCache } from '../../src/engine/texture/ScrubbingCache';
import { reserveRamPreviewImageElement } from '../../src/services/timeline/ramPreviewRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

// The constructor only stores the device reference (no GPU calls), so a stub
// device is enough to exercise the pure resolution-aware downscale helper.
type ScrubbingCacheTestAccess = {
  computeScrubCacheSize(width: number, height: number): { width: number; height: number };
  cacheCompositeFrame(time: number, imageData: ImageData): boolean;
  hasCompositeCacheFrame(time: number): boolean;
  clearCompositeCache(): void;
  clearScrubbingCache(videoSrc?: string): void;
  getOrCreateBackgroundSession(video: HTMLVideoElement): { videoSrc: string; video: HTMLVideoElement } | null;
  addToGpuCache(time: number, entry: {
    texture: GPUTexture;
    view: GPUTextureView;
    bindGroup: GPUBindGroup;
    width?: number;
    height?: number;
    format?: string;
    gpuBytes?: number;
  }): boolean;
  maxGpuCacheFrames: number;
  SCRUB_CACHE_MAX_DIMENSION: number;
};

const createCache = (): ScrubbingCacheTestAccess =>
  new ScrubbingCache({} as unknown as GPUDevice) as unknown as ScrubbingCacheTestAccess;

const createImageData = (width: number, height: number): ImageData =>
  ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }) as ImageData;

const createGpuEntry = (width: number, height: number) => ({
  texture: { destroy: vi.fn() } as unknown as GPUTexture,
  view: {} as GPUTextureView,
  bindGroup: {} as GPUBindGroup,
  width,
  height,
  format: 'rgba8unorm',
  gpuBytes: width * height * 4,
});

const createSourceVideo = (src = 'blob:source-video') => ({
  src,
  currentSrc: src,
  crossOrigin: 'anonymous',
  duration: 12,
}) as unknown as HTMLVideoElement;

const createBackgroundVideo = () => ({
  src: '',
  currentSrc: '',
  muted: false,
  preload: '',
  playsInline: false,
  crossOrigin: '',
  readyState: 0,
  networkState: 0,
  duration: 12,
  videoWidth: 1920,
  videoHeight: 1080,
  currentTime: 0,
  paused: true,
  seeking: false,
  load: vi.fn(),
  pause: vi.fn(),
  removeAttribute: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as HTMLVideoElement;

function retainBackgroundPreloadResource(index: number): void {
  timelineRuntimeCoordinator.retainResource({
    id: `retained-background-preload-${index}`,
    kind: 'html-media',
    policyId: 'background',
    owner: {
      ownerId: `retained-background-preload-${index}`,
      ownerType: 'timeline',
    },
    mediaElementKind: 'video',
    elementId: `retained-background-preload-${index}`,
  });
}

beforeEach(() => {
  timelineRuntimeCoordinator.clearResources();
});

afterEach(() => {
  timelineRuntimeCoordinator.clearResources();
  vi.restoreAllMocks();
});

describe('ScrubbingCache.computeScrubCacheSize', () => {
  it('downscales a 4K frame to the 960px longest-side cap, preserving aspect ratio', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(3840, 2160);
    expect(Math.max(size.width, size.height)).toBe(960);
    // 16:9 preserved
    expect(size.width / size.height).toBeCloseTo(3840 / 2160, 2);
  });

  it('downscales 1080p so coverage matches 4K (resolution-independent budget)', () => {
    const cache = createCache();
    const hd = cache.computeScrubCacheSize(1920, 1080);
    const uhd = cache.computeScrubCacheSize(3840, 2160);
    // Same downscaled dimensions => same VRAM per frame regardless of source res.
    expect(hd).toEqual(uhd);
  });

  it('never upscales frames already within the cap', () => {
    const cache = createCache();
    expect(cache.computeScrubCacheSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(cache.computeScrubCacheSize(960, 540)).toEqual({ width: 960, height: 540 });
  });

  it('handles portrait orientation by capping the longest (height) side', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(1080, 1920);
    expect(Math.max(size.width, size.height)).toBe(960);
    expect(size.height).toBe(960);
  });

  it('returns even dimensions for clean texture sizing', () => {
    const cache = createCache();
    const size = cache.computeScrubCacheSize(1280, 720);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
  });
});

describe('ScrubbingCache RAM preview runtime reporting', () => {
  it('reports CPU composite cache memory as an aggregate resource and releases it on clear', () => {
    const cache = createCache();
    cache.cacheCompositeFrame(1, createImageData(10, 10));
    cache.cacheCompositeFrame(2, createImageData(10, 10));

    let stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      imageBitmaps: 1,
      heapBytes: 800,
    });
    expect(stats.resources[0]).toMatchObject({
      id: 'ram-preview:composite-cache:image-data',
      kind: 'image-canvas',
      owner: {
        ownerId: 'ram-preview:composite-cache',
      },
    });

    cache.clearCompositeCache();
    stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(stats.resources).toHaveLength(0);
  });

  it('reports GPU frame cache textures and releases replaced frames', () => {
    const cache = createCache();
    const first = createGpuEntry(20, 10);
    const replacement = createGpuEntry(20, 10);

    cache.addToGpuCache(1, first);
    cache.addToGpuCache(1, replacement);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(first.texture.destroy).toHaveBeenCalledOnce();
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 1,
      gpuTextures: 1,
      gpuBytes: 800,
    });
    expect(stats.resources[0]).toMatchObject({
      id: 'ram-preview:gpu-frame-cache:1.000',
      kind: 'gpu-texture',
      textureKind: 'ram-preview-frame',
      dimensions: {
        width: 20,
        height: 10,
      },
    });
  });

  it('releases GPU frame cache resources when LRU eviction destroys textures', () => {
    const cache = createCache();
    cache.maxGpuCacheFrames = 1;
    const first = createGpuEntry(20, 10);
    const second = createGpuEntry(30, 10);

    cache.addToGpuCache(1, first);
    cache.addToGpuCache(2, second);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'];
    expect(first.texture.destroy).toHaveBeenCalledOnce();
    expect(stats.resources).toHaveLength(1);
    expect(stats.resources[0]).toMatchObject({
      id: 'ram-preview:gpu-frame-cache:2.000',
      memoryCost: {
        gpuBytes: 1200,
      },
    });
  });

  it('skips CPU composite cache storage when runtime admission is denied', () => {
    const cache = createCache();
    for (let index = 0; index < 96; index += 1) {
      reserveRamPreviewImageElement({
        runId: `existing-run-${index}`,
        clip: {
          id: `existing-image-${index}`,
          trackId: 'track-video',
          mediaFileId: `media-image-${index}`,
          duration: 1,
        },
      });
    }

    expect(cache.cacheCompositeFrame(1, createImageData(10, 10))).toBe(false);
    expect(cache.hasCompositeCacheFrame(1)).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(96);
  });

  it('skips GPU frame cache storage when runtime admission is denied', () => {
    const cache = createCache();
    for (let index = 0; index < 96; index += 1) {
      reserveRamPreviewImageElement({
        runId: `existing-run-${index}`,
        clip: {
          id: `existing-image-${index}`,
          trackId: 'track-video',
          mediaFileId: `media-image-${index}`,
          duration: 1,
        },
      });
    }
    const entry = createGpuEntry(20, 10);

    expect(cache.addToGpuCache(1, entry)).toBe(false);
    expect(entry.texture.destroy).toHaveBeenCalledOnce();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].budgetReport.usage.resources).toBe(96);
  });
});

describe('ScrubbingCache background preload runtime reporting', () => {
  it('reports background preload videos and releases them on source clear', () => {
    const cache = createCache();
    const backgroundVideo = createBackgroundVideo();
    vi.spyOn(document, 'createElement').mockReturnValue(backgroundVideo);

    const session = cache.getOrCreateBackgroundSession(createSourceVideo());

    expect(session?.video).toBe(backgroundVideo);
    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.background.resources;
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'html-media',
        policyId: 'background',
        mediaElementKind: 'video',
        srcKind: 'blob-url',
        tags: expect.arrayContaining(['background-preload']),
      }),
    ]));

    cache.clearScrubbingCache('blob:source-video');

    expect(backgroundVideo.pause).toHaveBeenCalledOnce();
    expect(backgroundVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(backgroundVideo.load).toHaveBeenCalledTimes(2);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(0);
  });

  it('skips background preload video allocation when background policy is full', () => {
    const cache = createCache();
    for (let index = 0; index < 6; index += 1) {
      retainBackgroundPreloadResource(index);
    }
    const createElement = vi.spyOn(document, 'createElement');

    expect(cache.getOrCreateBackgroundSession(createSourceVideo('blob:denied-source-video'))).toBeNull();

    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.budgetReport.usage.htmlMediaElements).toBe(6);
  });
});
