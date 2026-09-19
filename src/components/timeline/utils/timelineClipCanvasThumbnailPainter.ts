import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import { flockThumbnailService, isFlockThumbnailSourceId } from '../../../services/flock/flockThumbnailService';
import { ensureThumbnailBitmap, getThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { drawTimelineClipCanvasCover } from './timelineClipCanvasCoverDraw';

export function drawTimelineClipCanvasThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  mediaFileId: string,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
  maxThumbnailSlots: number,
  thumbnailSlotPx: number,
  staticThumbnailUrl?: string,
): number {
  const count = Math.max(1, Math.min(maxThumbnailSlots, Math.floor(w / thumbnailSlotPx)));
  const inPoint = clip.inPoint ?? 0;
  const urls = isFlockThumbnailSourceId(mediaFileId)
    ? flockThumbnailService.getUrlsForRange(clip.id, inPoint, clip.outPoint ?? inPoint + clip.duration, count, clip.reversed)
    : staticThumbnailUrl
    ? Array.from({ length: count }, () => staticThumbnailUrl)
    : thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      clip.inPoint ?? 0,
      clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
      count,
      clip.reversed,
    );
  const slotW = w / count;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const url = urls[i];
    if (!url) continue;
    const bmp = getThumbnailBitmap(url);
    if (bmp) {
      drawTimelineClipCanvasCover(ctx, bmp, x + i * slotW, top, slotW, h);
      drawn += 1;
    } else {
      ensureThumbnailBitmap(url, requestRedraw, mediaFileId);
    }
  }
  return drawn;
}

export function paintTimelineClipCanvasThumbnailGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  const gradient = ctx.createLinearGradient(0, top + height - 12, 0, top + height);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, top + Math.max(0, height - 12), width, Math.min(12, height));
}
