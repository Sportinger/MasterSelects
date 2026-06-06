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

describe('CacheManager runtime reporting cleanup', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('releases RAM preview cache reporting before dropping ScrubbingCache on device loss', () => {
    const manager = new CacheManager();
    manager.initialize({} as GPUDevice);
    manager.getScrubbingCache()?.cacheCompositeFrame(1, createImageData(10, 10));

    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(1);

    manager.handleDeviceLost();

    expect(timelineRuntimeCoordinator.getBridgeStats().policies['ram-preview'].resources).toHaveLength(0);
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
});
