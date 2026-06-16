import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../src/engine/managers/CacheManager';
import { reserveRamPreviewImageElement } from '../../src/services/timeline/ramPreviewRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

const createImageData = (width: number, height: number): ImageData =>
  ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }) as ImageData;

type ScrubbingCacheDeviceLossTestAccess = {
  getOrCreateBackgroundSession(video: HTMLVideoElement): { video: HTMLVideoElement } | null;
  cacheCompositeFrame(time: number, imageData: ImageData): boolean;
  getWorkerFirstCacheRuntimeSnapshot(): {
    records: readonly {
      cacheId: string;
      entries: number;
      bytes: number;
      allocations: number;
      reuses: number;
    }[];
  };
};

const createSourceVideo = () => ({
  src: 'blob:device-loss-source',
  currentSrc: 'blob:device-loss-source',
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

describe('CacheManager runtime reporting cleanup', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('destroys ScrubbingCache resources before dropping it on device loss', () => {
    const manager = new CacheManager();
    manager.initialize({} as GPUDevice);
    manager.getScrubbingCache()?.cacheCompositeFrame(1, createImageData(10, 10));
    const backgroundVideo = createBackgroundVideo();
    vi.spyOn(document, 'createElement').mockReturnValue(backgroundVideo);
    (manager.getScrubbingCache() as unknown as ScrubbingCacheDeviceLossTestAccess)
      .getOrCreateBackgroundSession(createSourceVideo());

    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(1);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(1);

    manager.handleDeviceLost();

    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.background.resources).toHaveLength(0);
    expect(backgroundVideo.pause).toHaveBeenCalledOnce();
    expect(backgroundVideo.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('skips ImageData allocation when RAM preview composite cache admission is denied', async () => {
    const manager = new CacheManager();
    manager.initialize({} as GPUDevice);
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
    const ImageDataCtor = vi.fn();
    vi.stubGlobal('ImageData', ImageDataCtor);

    await manager.cacheCompositeFrame(
      1,
      async () => new Uint8ClampedArray(10 * 10 * 4),
      () => ({ width: 10, height: 10 })
    );

    expect(ImageDataCtor).not.toHaveBeenCalled();
    expect(manager.hasCompositeCacheFrame(1)).toBe(false);
  });

  it('reports RAM preview composite cache as cloneable worker-first cache runtime data', () => {
    const manager = new CacheManager();
    manager.initialize({} as GPUDevice);

    manager.getScrubbingCache()?.cacheCompositeFrame(1, createImageData(10, 10));
    manager.getScrubbingCache()?.cacheCompositeFrame(1, createImageData(10, 10));

    const snapshot = manager.getWorkerFirstCacheRuntimeSnapshot();
    const composite = snapshot.records.find((record) => record.cacheId === 'ram-preview:composite-cache');

    expect(composite).toMatchObject({
      entries: 1,
      bytes: 400,
      allocations: 1,
      reuses: 1,
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
