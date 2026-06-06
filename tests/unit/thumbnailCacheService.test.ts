import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThumbnailGenerationVideo,
  createThumbnailGenerationVideoFromUrl,
  thumbnailCacheService,
  type ThumbnailCacheEvent,
} from '../../src/services/thumbnailCacheService';
import { projectDB } from '../../src/services/projectDB';
import {
  clearThumbnailBitmapCache,
  ensureThumbnailBitmap,
  getThumbnailBitmap,
} from '../../src/services/timeline/thumbnailBitmapCache';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { TIMELINE_RUNTIME_POLICY_DESCRIPTORS } from '../../src/services/timeline/runtimeCoordinatorContracts';
import {
  createThumbnailGenerationCanvasDescriptor,
  createThumbnailGenerationVideoDescriptor,
  createThumbnailJobDescriptor,
} from '../../src/services/timeline/thumbnailRuntimeReporting';

type ThumbnailCacheServiceTestAccess = typeof thumbnailCacheService & {
  loadFromDB(mediaFileId: string, fileHash?: string): Promise<boolean>;
  loadFramesIntoCache(
    mediaFileId: string,
    frames: Array<{ secondIndex: number; blob: Blob }>,
  ): void;
  generateThumbnails(
    mediaFileId: string,
    video: HTMLVideoElement,
    duration: number,
    fileHash: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean>;
};

describe('thumbnailCacheService', () => {
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

  it('creates an isolated thumbnail video from the source element', () => {
    const clonedVideo = {
      src: '',
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(clonedVideo);

    const sourceVideo = {
      src: 'blob:source-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;

    const result = createThumbnailGenerationVideo(sourceVideo);

    expect(result).toBe(clonedVideo);
    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(clonedVideo.src).toBe('blob:source-video');
    expect(clonedVideo.preload).toBe('auto');
    expect(clonedVideo.muted).toBe(true);
    expect(clonedVideo.playsInline).toBe(true);
    expect(clonedVideo.crossOrigin).toBe('anonymous');
    expect(clonedVideo.load).toHaveBeenCalled();
  });

  it('creates an isolated thumbnail video from a source URL', () => {
    const clonedVideo = {
      src: '',
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
    } as unknown as HTMLVideoElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(clonedVideo);

    const result = createThumbnailGenerationVideoFromUrl('blob:source-url', 'use-credentials');

    expect(result).toBe(clonedVideo);
    expect(createElementSpy).toHaveBeenCalledWith('video');
    expect(clonedVideo.src).toBe('blob:source-url');
    expect(clonedVideo.preload).toBe('auto');
    expect(clonedVideo.muted).toBe(true);
    expect(clonedVideo.playsInline).toBe(true);
    expect(clonedVideo.crossOrigin).toBe('use-credentials');
    expect(clonedVideo.load).toHaveBeenCalled();
  });

  it('generates thumbnails from the isolated video instead of the preview video', async () => {
    const previewVideo = {
      src: 'blob:preview-video',
      currentSrc: '',
      crossOrigin: 'anonymous',
    } as HTMLVideoElement;
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);

    await thumbnailCacheService.generateForSource(
      `media-thumb-test-${Date.now()}`,
      previewVideo,
      12
    );

    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      isolatedVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(generateSpy).not.toHaveBeenCalledWith(
      expect.any(String),
      previewVideo,
      12,
      undefined,
      expect.any(AbortSignal)
    );
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('generates thumbnails from a source URL without a hydrated preview video', async () => {
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);

    await thumbnailCacheService.generateForSourceUrl(
      `media-thumb-url-test-${Date.now()}`,
      'blob:source-url',
      12,
      'hash-a',
      'use-credentials',
    );

    expect(isolatedVideo.src).toBe('blob:source-url');
    expect(isolatedVideo.crossOrigin).toBe('use-credentials');
    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(String),
      isolatedVideo,
      12,
      'hash-a',
      expect.any(AbortSignal),
    );
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('loads cached thumbnails without creating a video element or generating frames', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-cached-thumb-test-${Date.now()}`;
    const loadFromDbSpy = vi.spyOn(service, 'loadFromDB').mockResolvedValue(true);
    const generateSpy = vi
      .spyOn(service, 'generateThumbnails')
      .mockResolvedValue(undefined);
    const createElementSpy = vi.spyOn(document, 'createElement');

    await expect(thumbnailCacheService.loadCachedForSource(mediaFileId, 'hash-a')).resolves.toBe(true);

    expect(loadFromDbSpy).toHaveBeenCalledWith(mediaFileId, 'hash-a', expect.any(Number));
    expect(generateSpy).not.toHaveBeenCalled();
    expect(createElementSpy).not.toHaveBeenCalled();
  });

  it('reports cached thumbnail DB load jobs while IndexedDB work is pending', async () => {
    const mediaFileId = `media-db-load-report-${Date.now()}`;
    let resolveFrames: (frames: Array<{ secondIndex: number; blob: Blob }>) => void = () => {};
    vi.spyOn(projectDB, 'getSourceThumbnails').mockReturnValue(
      new Promise((resolve) => {
        resolveFrames = resolve;
      }),
    );

    const loadPromise = thumbnailCacheService.loadCachedForSource(mediaFileId, 'hash-a');
    await vi.waitFor(() => expect(projectDB.getSourceThumbnails).toHaveBeenCalledWith(mediaFileId));

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage.jobs).toBe(1);

    resolveFrames([]);
    await expect(loadPromise).resolves.toBe(false);

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage.jobs).toBe(0);
  });

  it('skips cached thumbnail DB loads before IndexedDB work when job admission is over budget', async () => {
    for (let index = 0; index < 4; index += 1) {
      timelineRuntimeCoordinator.retainResource(createThumbnailJobDescriptor({
        jobId: `retained-thumbnail-job-${index}`,
        jobKind: 'thumbnail-db-load',
        mediaFileId: `media-retained-${index}`,
      }));
    }
    const getSourceThumbnails = vi.spyOn(projectDB, 'getSourceThumbnails').mockResolvedValue([]);

    await expect(thumbnailCacheService.loadCachedForSource('media-denied-db', 'hash-a')).resolves.toBe(false);

    expect(getSourceThumbnails).not.toHaveBeenCalled();
    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(usage.jobs).toBe(4);
  });

  it('reports thumbnail generation job and detached video only while generation is active', async () => {
    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const mediaFileId = `media-generation-report-${Date.now()}`;
    let resolveGeneration: (() => void) | undefined;

    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    vi.spyOn(service, 'generateThumbnails').mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveGeneration = resolve;
      }),
    );

    const generatePromise = thumbnailCacheService.generateForSourceUrl(
      mediaFileId,
      'blob:source-url',
      12,
      'hash-a',
    );

    await vi.waitFor(() => {
      const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
      expect(usage.jobs).toBe(1);
      expect(usage.htmlMediaElements).toBe(1);
    });

    resolveGeneration?.(true);
    await generatePromise;

    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(usage.jobs).toBe(0);
    expect(usage.htmlMediaElements).toBe(0);
  });

  it('skips thumbnail generation before detached video creation when job admission is over budget', async () => {
    for (let index = 0; index < 4; index += 1) {
      timelineRuntimeCoordinator.retainResource(createThumbnailJobDescriptor({
        jobId: `retained-generation-job-${index}`,
        jobKind: 'thumbnail-generation',
        mediaFileId: `media-retained-generation-${index}`,
      }));
    }

    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const loadFromDb = vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateThumbnails = vi.spyOn(service, 'generateThumbnails').mockResolvedValue(true);
    const createElement = vi.spyOn(document, 'createElement');

    await thumbnailCacheService.generateForSourceUrl('media-denied-generation', 'blob:source-url', 12, 'hash-a');

    expect(loadFromDb).not.toHaveBeenCalled();
    expect(generateThumbnails).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    expect(thumbnailCacheService.getStatus('media-denied-generation')).toBe('none');
    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(usage.jobs).toBe(4);
  });

  it('cleans up detached thumbnail video and resets status when video admission is over budget', async () => {
    const retainedVideo = {
      src: 'blob:retained',
      readyState: 2,
      paused: true,
      seeking: false,
      currentTime: 0,
      networkState: 1,
    } as HTMLVideoElement;
    for (let index = 0; index < 4; index += 1) {
      timelineRuntimeCoordinator.retainResource(createThumbnailGenerationVideoDescriptor({
        mediaFileId: `media-retained-video-${index}`,
        sourceUrl: `blob:retained-${index}`,
        element: retainedVideo,
      }));
    }

    const isolatedVideo = {
      src: '',
      readyState: 2,
      duration: 12,
      preload: 'metadata',
      muted: false,
      playsInline: false,
      crossOrigin: '',
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    vi.spyOn(document, 'createElement').mockReturnValue(isolatedVideo);
    vi.spyOn(service, 'loadFromDB').mockResolvedValue(false);
    const generateThumbnails = vi.spyOn(service, 'generateThumbnails').mockResolvedValue(true);

    await thumbnailCacheService.generateForSourceUrl('media-denied-video', 'blob:source-url', 12, 'hash-a');

    expect(generateThumbnails).not.toHaveBeenCalled();
    expect(isolatedVideo.pause).toHaveBeenCalled();
    expect(isolatedVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(thumbnailCacheService.getStatus('media-denied-video')).toBe('none');
    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(usage.htmlMediaElements).toBe(4);
    expect(usage.jobs).toBe(0);
  });

  it('ignores stale cached thumbnail loads after a source clear', async () => {
    const mediaFileId = `media-stale-load-test-${Date.now()}`;
    let resolveLoad: (frames: Array<{ secondIndex: number; blob: Blob }>) => void = () => {};
    const pendingFrames = new Promise<Array<{ secondIndex: number; blob: Blob }>>((resolve) => {
      resolveLoad = resolve;
    });
    vi.spyOn(projectDB, 'getSourceThumbnails').mockReturnValue(pendingFrames);
    vi.spyOn(projectDB, 'deleteSourceThumbnails').mockResolvedValue(undefined);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale-thumb');

    const loadPromise = thumbnailCacheService.loadCachedForSource(mediaFileId, 'hash-old');
    await vi.waitFor(() => expect(projectDB.getSourceThumbnails).toHaveBeenCalledWith(mediaFileId));

    await thumbnailCacheService.clearSource(mediaFileId);
    resolveLoad([{ secondIndex: 0, blob: new Blob(['old-thumb']) }]);

    await expect(loadPromise).resolves.toBe(false);
    expect(thumbnailCacheService.hasSource(mediaFileId)).toBe(false);
    expect(thumbnailCacheService.getCount(mediaFileId)).toBe(0);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('closes decoded thumbnail bitmaps before revoking source blob URLs on memory eviction', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-bitmap-evict-test-${Date.now()}`;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source-thumb-frame');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['thumb'])),
    } as Response);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));

    service.loadFramesIntoCache(mediaFileId, [
      { secondIndex: 0, blob: new Blob(['thumb']) },
    ]);
    ensureThumbnailBitmap('blob:source-thumb-frame', vi.fn(), mediaFileId);
    await vi.waitFor(() => expect(getThumbnailBitmap('blob:source-thumb-frame')).toBe(bitmap));

    thumbnailCacheService.evictFromMemory(mediaFileId);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:source-thumb-frame');
    expect(getThumbnailBitmap('blob:source-thumb-frame')).toBeNull();
  });

  it('emits frame indexes when cached thumbnails are loaded into memory', () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-thumb-event-load-${Date.now()}`;
    const events: ThumbnailCacheEvent[] = [];
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:source-thumb-0')
      .mockReturnValueOnce('blob:source-thumb-2');
    const unsubscribe = thumbnailCacheService.subscribe((_mediaFileId, _status, event) => {
      if (event) events.push(event);
    });

    service.loadFramesIntoCache(mediaFileId, [
      { secondIndex: 0, blob: new Blob(['thumb-0']) },
      { secondIndex: 2, blob: new Blob(['thumb-2']) },
    ]);
    unsubscribe();

    expect(events).toContainEqual({
      type: 'frames-loaded',
      mediaFileId,
      status: 'ready',
      secondIndices: [0, 2],
      count: 2,
    });
  });

  it('keeps legacy two-argument thumbnail subscribers compatible', () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-thumb-event-legacy-${Date.now()}`;
    const statuses: Array<[string, string]> = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source-thumb-legacy');
    const legacyListener = (changedMediaFileId: string, status: string) => {
      statuses.push([changedMediaFileId, status]);
    };
    const unsubscribe = thumbnailCacheService.subscribe(legacyListener);

    service.loadFramesIntoCache(mediaFileId, [
      { secondIndex: 1, blob: new Blob(['thumb-1']) },
    ]);
    unsubscribe();

    expect(statuses).toEqual([[mediaFileId, 'ready']]);
  });

  it('emits frame-ready events while generating thumbnails', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-thumb-event-generate-${Date.now()}`;
    const events: ThumbnailCacheEvent[] = [];
    const seekedListeners = new Set<() => void>();
    let objectUrlIndex = 0;
    const originalCreateElement = document.createElement.bind(document);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['thumb']))),
    } as unknown as HTMLCanvasElement;
    const video = {
      readyState: 2,
      addEventListener: vi.fn((event: string, callback: EventListenerOrEventListenerObject) => {
        if (event === 'seeked') {
          seekedListeners.add(callback as () => void);
        }
      }),
      removeEventListener: vi.fn((event: string, callback: EventListenerOrEventListenerObject) => {
        if (event === 'seeked') {
          seekedListeners.delete(callback as () => void);
        }
      }),
      set currentTime(_value: number) {
        queueMicrotask(() => {
          for (const listener of [...seekedListeners]) {
            listener();
          }
        });
      },
      get currentTime() {
        return 0;
      },
    } as unknown as HTMLVideoElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : originalCreateElement(tagName)
    ));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:generated-thumb-${objectUrlIndex++}`);
    vi.spyOn(projectDB, 'saveSourceThumbnailsBatch').mockResolvedValue(undefined);
    const unsubscribe = thumbnailCacheService.subscribe((_mediaFileId, _status, event) => {
      if (event?.type === 'frame-ready') events.push(event);
    });

    await service.generateThumbnails(mediaFileId, video, 2, 'hash-a', new AbortController().signal);
    unsubscribe();

    expect(events).toEqual([
      {
        type: 'frame-ready',
        mediaFileId,
        status: 'generating',
        secondIndex: 0,
        secondIndices: [0],
        count: 1,
      },
      {
        type: 'frame-ready',
        mediaFileId,
        status: 'generating',
        secondIndex: 1,
        secondIndices: [1],
        count: 1,
      },
    ]);
  });

  it('captures a frame when the thumbnail video is already at the seek target without firing seeked', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-thumb-same-time-${Date.now()}`;
    const originalCreateElement = document.createElement.bind(document);
    let currentTime = 0;
    let objectUrlIndex = 0;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['thumb']))),
    } as unknown as HTMLCanvasElement;
    const video = {
      readyState: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      set currentTime(value: number) {
        currentTime = value;
      },
      get currentTime() {
        return currentTime;
      },
    } as unknown as HTMLVideoElement;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : originalCreateElement(tagName)
    ));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:generated-same-time-thumb-${objectUrlIndex++}`);
    vi.spyOn(projectDB, 'saveSourceThumbnailsBatch').mockResolvedValue(undefined);

    const generated = await service.generateThumbnails(
      mediaFileId,
      video,
      1,
      'hash-a',
      new AbortController().signal,
    );

    expect(generated).toBe(true);
    expect(canvas.getContext).toHaveBeenCalled();
    expect(canvas.toBlob).toHaveBeenCalledTimes(1);
    expect(thumbnailCacheService.getCount(mediaFileId)).toBe(1);
  });

  it('returns false before frame work when thumbnail generation canvas admission is over budget', async () => {
    const thumbnailPolicy = TIMELINE_RUNTIME_POLICY_DESCRIPTORS.find((policy) => policy.id === 'thumbnail');
    const maxImageBitmaps = thumbnailPolicy?.defaultBudget.maxImageBitmaps ?? 256;
    for (let index = 0; index < maxImageBitmaps; index += 1) {
      timelineRuntimeCoordinator.retainResource(
        createThumbnailGenerationCanvasDescriptor(`media-retained-canvas-${index}`)
      );
    }

    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const mediaFileId = `media-canvas-admission-${Date.now()}`;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['thumb']))),
    } as unknown as HTMLCanvasElement;
    const video = {
      readyState: 2,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const generated = await service.generateThumbnails(
      mediaFileId,
      video,
      2,
      'hash-a',
      new AbortController().signal
    );

    expect(generated).toBe(false);
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(thumbnailCacheService.hasSource(mediaFileId)).toBe(false);
    const usage = timelineRuntimeCoordinator.getBridgeStats().policies.thumbnail.budgetReport.usage;
    expect(usage.resources).toBe(maxImageBitmaps);
  });

  it('emits memory eviction and source clear events', async () => {
    const service = thumbnailCacheService as unknown as ThumbnailCacheServiceTestAccess;
    const evictedMediaFileId = `media-thumb-event-evict-${Date.now()}`;
    const clearedMediaFileId = `media-thumb-event-clear-${Date.now()}`;
    const events: ThumbnailCacheEvent[] = [];
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:source-thumb-evict')
      .mockReturnValueOnce('blob:source-thumb-clear');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(projectDB, 'deleteSourceThumbnails').mockResolvedValue(undefined);
    const unsubscribe = thumbnailCacheService.subscribe((_mediaFileId, _status, event) => {
      if (event) events.push(event);
    });

    service.loadFramesIntoCache(evictedMediaFileId, [
      { secondIndex: 3, blob: new Blob(['thumb-3']) },
    ]);
    thumbnailCacheService.evictFromMemory(evictedMediaFileId);
    service.loadFramesIntoCache(clearedMediaFileId, [
      { secondIndex: 4, blob: new Blob(['thumb-4']) },
    ]);
    await thumbnailCacheService.clearSource(clearedMediaFileId);
    unsubscribe();

    expect(events).toContainEqual({
      type: 'memory-evicted',
      mediaFileId: evictedMediaFileId,
      status: 'none',
      secondIndices: [3],
      count: 1,
    });
    expect(events).toContainEqual({
      type: 'source-cleared',
      mediaFileId: clearedMediaFileId,
      status: 'none',
    });
  });
});
