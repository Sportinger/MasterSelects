import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailMemoryTier } from '../../src/services/thumbnailCache/memoryTier';
import { thumbnailCacheService } from '../../src/services/thumbnailCacheService';
import * as bitmaps from '../../src/services/timeline/thumbnailBitmapCache';
import { collectTimelineClipCanvasWorkerThumbnailPreparation } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';
import { drawTimelineClipCanvasThumbnails } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPainter';
import type { TimelinePaintSourceClip } from '../../src/timeline';

afterEach(() => vi.restoreAllMocks());

describe.each(['worker', 'software'] as const)('progressive thumbnail decode (%s)', (renderer) => {
  it.each([false, true])('retains decoded previews until replacements are ready (reverse=%s)', (reversed) => {
    const memory = new ThumbnailMemoryTier();
    const frames = memory.createSourceCache('source');
    frames.set(0, 'blob:first');
    const first = { width: 160, height: 90 } as ImageBitmap;
    const next = { width: 160, height: 90 } as ImageBitmap;
    const decoded = new Map([['blob:first', first]]);
    vi.spyOn(bitmaps, 'hasThumbnailBitmap').mockImplementation((url) => decoded.has(url));
    vi.spyOn(bitmaps, 'getThumbnailBitmap').mockImplementation((url) => decoded.get(url) ?? null);
    const warmup = vi.spyOn(bitmaps, 'ensureThumbnailBitmap').mockImplementation(() => {});
    vi.spyOn(thumbnailCacheService, 'getThumbnailsForRange').mockImplementation(
      (...args) => memory.getThumbnailsForRange(...args),
    );
    vi.spyOn(thumbnailCacheService, 'getDecodedThumbnailsForRange').mockImplementation(
      (...args) => memory.getThumbnailsForRange(...args, (url) => decoded.has(url)),
    );
    const clip: TimelinePaintSourceClip = {
      id: 'clip', name: 'Video', trackId: 'video', startTime: 0, duration: 4,
      inPoint: 0, outPoint: 4, reversed, source: { type: 'video', mediaFileId: 'source' },
    };
    const drawImage = vi.fn();
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
    const paint = () => {
      if (renderer === 'software') {
        drawImage.mockClear();
        drawTimelineClipCanvasThumbnails(ctx, clip, 'source', 0, 0, 200, 60, vi.fn(), 2, 100);
        return drawImage.mock.calls.map(([bitmap]) => bitmap);
      }
      const prepared = collectTimelineClipCanvasWorkerThumbnailPreparation({
        clips: [clip], height: 60, cssWidth: 200, canvasOffsetX: 0, scrollX: 0,
        viewportWidth: 200, timeToPixel: (time) => time * 50,
        resolveGeometry: () => ({ startTime: 0, duration: 4, inPoint: 0, outPoint: 4, visible: true }),
        renderOverscanPx: 0, thumbnailViewportOverscanPx: 0, minThumbnailWidth: 1,
        thumbnailSlotPx: 100, maxThumbnailSlots: 2,
      });
      if (frames.has(2) && !decoded.has('blob:next')) {
        expect(prepared.missingBitmapRefs).toEqual([{ url: 'blob:next', mediaFileId: 'source' }]);
        expect(prepared.visibleBitmapClipIds.has(clip.id)).toBe(true);
      }
      return prepared.plansByClipId.get(clip.id)?.urls.map((url) => url ? decoded.get(url) : null) ?? [];
    };

    expect(paint()).toEqual([first, first]);
    frames.set(2, 'blob:next'); // Published URL, but asynchronous decode is still pending.
    expect(paint()).toEqual([first, first]);
    if (renderer === 'software') expect(warmup).toHaveBeenCalledWith('blob:next', expect.any(Function), 'source');
    decoded.set('blob:next', next);
    expect(paint()).toEqual(reversed ? [next, first] : [first, next]);

    // Invalidation must not retain stale images, nor borrow from another source.
    memory.createSourceCache('other').set(0, 'blob:first');
    frames.clear();
    expect(paint()).toEqual([]);
  });
});
