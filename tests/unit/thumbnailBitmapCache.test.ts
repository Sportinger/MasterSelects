import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearThumbnailBitmapCache,
  closeByThumbnailUrls,
  closeSource,
  ensureThumbnailBitmap,
  getThumbnailBitmap,
  getThumbnailBitmapCacheSize,
  hasThumbnailBitmap,
} from '../../src/services/timeline/thumbnailBitmapCache';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import {
  createThumbnailBitmapResourceDescriptor,
  createThumbnailJobDescriptor,
} from '../../src/services/timeline/thumbnailRuntimeReporting';

describe('thumbnailBitmapCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearThumbnailBitmapCache();
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    clearThumbnailBitmapCache();
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('closes decoded bitmaps by source id', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const onReady = vi.fn();

    ensureThumbnailBitmap('blob:source-a-frame-0', onReady, 'media-a');
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

    expect(getThumbnailBitmap('blob:source-a-frame-0')).toBe(bitmap);
    expect(hasThumbnailBitmap('blob:source-a-frame-0')).toBe(true);
    closeSource('media-a');

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(getThumbnailBitmap('blob:source-a-frame-0')).toBeNull();
    expect(getThumbnailBitmapCacheSize()).toBe(0);
  });

  it('closes decoded bitmaps by thumbnail URL', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));

    ensureThumbnailBitmap('blob:frame-url', vi.fn(), 'media-a');
    await vi.waitFor(() => expect(getThumbnailBitmap('blob:frame-url')).toBe(bitmap));

    closeByThumbnailUrls(['blob:frame-url']);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(getThumbnailBitmap('blob:frame-url')).toBeNull();
  });

  it('closes a bitmap that finishes decoding after its URL was invalidated', async () => {
    let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined;
    const bitmapPromise = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(bitmapPromise));
    const onReady = vi.fn();

    ensureThumbnailBitmap('blob:late-frame', onReady, 'media-a');
    closeSource('media-a');
    resolveBitmap?.(bitmap);
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledTimes(1));

    expect(onReady).not.toHaveBeenCalled();
    expect(getThumbnailBitmap('blob:late-frame')).toBeNull();
  });

  it('reports bitmap decode job and retained image bitmap resources to the thumbnail policy', async () => {
    let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined;
    const bitmapPromise = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(bitmapPromise));
    const onReady = vi.fn();

    ensureThumbnailBitmap('blob:reported-frame', onReady, 'media-a');
    await vi.waitFor(() => {
      expect(timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage.jobs).toBe(1);
    });

    resolveBitmap?.(bitmap);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

    let thumbnailUsage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(thumbnailUsage.jobs).toBe(0);
    expect(thumbnailUsage.imageBitmaps).toBe(1);

    closeSource('media-a');

    thumbnailUsage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(thumbnailUsage.resources).toBe(0);
    expect(thumbnailUsage.imageBitmaps).toBe(0);
  });

  it('skips fetch and decode when thumbnail bitmap admission is over budget', () => {
    const thumbnailBitmapLimit = timelineRuntimeCoordinator.getPolicy('thumbnail')?.defaultBudget.maxImageBitmaps;
    expect(thumbnailBitmapLimit).toBeGreaterThan(0);

    for (let index = 0; index < thumbnailBitmapLimit; index += 1) {
      timelineRuntimeCoordinator.retainResource(
        createThumbnailBitmapResourceDescriptor(`blob:retained-frame-${index}`, `media-${index}`)
      );
    }

    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const onReady = vi.fn();

    ensureThumbnailBitmap('blob:over-budget-frame', onReady, 'media-over-budget');

    expect(fetch).not.toHaveBeenCalled();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(getThumbnailBitmap('blob:over-budget-frame')).toBeNull();
    expect(hasThumbnailBitmap('blob:over-budget-frame')).toBe(false);

    const thumbnailUsage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(thumbnailUsage.resources).toBe(thumbnailBitmapLimit);
    expect(thumbnailUsage.jobs).toBe(0);
  });

  it('skips fetch and decode when thumbnail bitmap decode jobs are over budget', () => {
    const maxJobs = timelineRuntimeCoordinator.getPolicy('thumbnail')?.defaultBudget.maxJobs ?? 4;
    for (let index = 0; index < maxJobs; index += 1) {
      timelineRuntimeCoordinator.retainResource(createThumbnailJobDescriptor({
        jobId: `retained-thumbnail-decode-job-${index}`,
        jobKind: 'thumbnail-bitmap-decode',
        mediaFileId: `media-${index}`,
        thumbnailUrl: `blob:retained-job-${index}`,
      }));
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    ensureThumbnailBitmap('blob:over-job-budget-frame', vi.fn(), 'media-over-job-budget');

    expect(fetch).not.toHaveBeenCalled();
    expect(createImageBitmapMock).not.toHaveBeenCalled();
    const thumbnailUsage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(thumbnailUsage.jobs).toBe(maxJobs);
  });
});
