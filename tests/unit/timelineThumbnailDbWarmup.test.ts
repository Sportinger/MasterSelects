import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectVisibleTimelineThumbnailRefs,
  scheduleVisibleTimelineThumbnailDbWarmup,
  warmVisibleTimelineThumbnailDbCache,
} from '../../src/services/timeline/timelineThumbnailDbWarmup';

describe('timeline thumbnail DB warmup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces visible thumbnail DB loads by media id and file hash', async () => {
    const loadCachedForSource = vi.fn<(mediaFileId: string, fileHash?: string) => Promise<boolean>>()
      .mockResolvedValue(true);

    const results = await warmVisibleTimelineThumbnailDbCache([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
      { mediaFileId: 'media-a', fileHash: 'hash-b' },
      { mediaFileId: 'media-b' },
    ], {
      deps: { loadCachedForSource },
    });

    expect(results).toEqual([true, true, true]);
    expect(loadCachedForSource).toHaveBeenCalledTimes(3);
    expect(loadCachedForSource).toHaveBeenNthCalledWith(1, 'media-a', 'hash-a');
    expect(loadCachedForSource).toHaveBeenNthCalledWith(2, 'media-a', 'hash-b');
    expect(loadCachedForSource).toHaveBeenNthCalledWith(3, 'media-b', undefined);
  });

  it('collects only visible video thumbnail refs with file hashes', () => {
    const refs = collectVisibleTimelineThumbnailRefs({
      clips: [
        {
          startTime: 0,
          duration: 1,
          mediaFileId: 'top-level-video',
          source: { type: 'video' },
        },
        {
          startTime: 2,
          duration: 1,
          source: { type: 'video', mediaFileId: 'source-video' },
        },
        {
          startTime: 99,
          duration: 1,
          source: { type: 'video', mediaFileId: 'offscreen-video' },
        },
        {
          startTime: 1,
          duration: 1,
          source: { type: 'audio', mediaFileId: 'audio-media' },
        },
        {
          startTime: 2.25,
          duration: 0.5,
          source: { type: 'video', mediaFileId: 'source-video' },
        },
      ],
      scrollX: 0,
      viewportWidth: 300,
      overscanPx: 0,
      timeToPixel: (time) => time * 100,
      mediaFileHashById: new Map([
        ['top-level-video', 'hash-top'],
        ['source-video', 'hash-source'],
      ]),
    });

    expect(refs).toEqual([
      { mediaFileId: 'top-level-video', fileHash: 'hash-top' },
      { mediaFileId: 'source-video', fileHash: 'hash-source' },
    ]);
  });

  it('shares an in-flight DB load across overlapping warm requests', async () => {
    let resolveLoad: ((value: boolean) => void) | undefined;
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
    });
    const loadCachedForSource = vi.fn<(mediaFileId: string, fileHash?: string) => Promise<boolean>>()
      .mockReturnValue(loadPromise);

    const first = warmVisibleTimelineThumbnailDbCache([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], {
      deps: { loadCachedForSource },
    });
    const second = warmVisibleTimelineThumbnailDbCache([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], {
      deps: { loadCachedForSource },
    });

    expect(loadCachedForSource).toHaveBeenCalledTimes(1);
    resolveLoad?.(true);

    await expect(first).resolves.toEqual([true]);
    await expect(second).resolves.toEqual([true]);
  });

  it('can cancel a scheduled visible warmup before DB work starts', () => {
    vi.useFakeTimers();
    const loadCachedForSource = vi.fn<(mediaFileId: string, fileHash?: string) => Promise<boolean>>()
      .mockResolvedValue(true);

    const cancel = scheduleVisibleTimelineThumbnailDbWarmup([
      { mediaFileId: 'media-a', fileHash: 'hash-a' },
    ], {
      deps: { loadCachedForSource },
      delayMs: 50,
    });

    cancel();
    vi.advanceTimersByTime(60);

    expect(loadCachedForSource).not.toHaveBeenCalled();
  });
});
