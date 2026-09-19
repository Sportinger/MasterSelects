import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawTimelineClipCanvasMainThread } from '../../src/components/timeline/utils/timelineClipCanvasMainThreadDraw';
import { collectTimelineClipCanvasWorkerThumbnailPreparation } from '../../src/components/timeline/utils/timelineClipCanvasThumbnailPreparation';
import { resolveClipGeometry } from '../../src/components/timeline/utils/timelineClipCanvasClipGeometry';
import { thumbnailCacheService } from '../../src/services/thumbnailCacheService';
import * as thumbnailBitmaps from '../../src/services/timeline/thumbnailBitmapCache';
import type { TimelinePaintSourceClip } from '../../src/timeline';

function createContext(): CanvasRenderingContext2D {
  const context: Record<string, unknown> = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: () => ({ width: 20 }),
  };
  return new Proxy(context, {
    get(target, property: string) { return target[property] ??= vi.fn(); },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => vi.restoreAllMocks());

describe.each(['software', 'worker'] as const)('trimmed thumbnail timing (%s)', (renderer) => {
  it.each([
    { reversed: false, scroll: 0, expected: [10, 14] },
    { reversed: false, scroll: 600, expected: [22, 26] },
    { reversed: true, scroll: 0, expected: [26, 30] },
    { reversed: true, scroll: 600, expected: [14, 18] },
  ])('samples the visible source window for $reversed reverse, scroll $scroll', ({ reversed, scroll, expected }) => {
    const clip: TimelinePaintSourceClip = {
      id: 'trimmed', name: 'Trimmed video', trackId: 'v1', startTime: 0,
      duration: 10, inPoint: 10, outPoint: 30, reversed,
      source: { type: 'video', mediaFileId: 'source', naturalDuration: 60 },
    };
    const thumbnails = vi.spyOn(thumbnailCacheService, 'getThumbnailsForRange').mockReturnValue(['blob:frame']);
    vi.spyOn(thumbnailBitmaps, 'hasThumbnailBitmap').mockReturnValue(true);
    vi.spyOn(thumbnailBitmaps, 'getThumbnailBitmap').mockReturnValue({ width: 160, height: 90 } as ImageBitmap);
    const shared = {
      clips: [clip], height: 60, cssWidth: 200, canvasOffsetX: scroll,
      scrollX: scroll, viewportWidth: 200, timeToPixel: (time: number) => time * 100,
      resolveGeometry: (value: TimelinePaintSourceClip) => resolveClipGeometry(value, { trackId: 'v1' }),
      renderOverscanPx: 0, thumbnailViewportOverscanPx: 0, maxThumbnailSlots: 2, thumbnailSlotPx: 100,
    };
    if (renderer === 'worker') {
      const result = collectTimelineClipCanvasWorkerThumbnailPreparation({ ...shared, minThumbnailWidth: 24 });
      expect(result.plansByClipId.get(clip.id)?.urls).toEqual(['blob:frame']);
    } else {
      const result = drawTimelineClipCanvasMainThread({
        ...shared, ctx: createContext(), selectedClipIds: new Set(), trackColor: '#4c9aff',
        lodBarPx: 2, lodThumbnailPx: 24, getMediaStatus: () => undefined, requestRedraw: vi.fn(),
      });
      expect(result.thumbnailDrawCount).toBe(1);
    }
    expect(thumbnails).toHaveBeenCalledWith('source', ...expected, 2, reversed);
  });
});
