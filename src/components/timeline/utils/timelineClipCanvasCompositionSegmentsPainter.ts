import { getThumbnailBitmap, ensureThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { drawTimelineClipCanvasCover } from './timelineClipCanvasCoverDraw';
import { getTimelineClipCanvasCompositionThumbnailSlotUrls } from './timelineClipCanvasCompositionResource';

interface DrawTimelineClipCanvasCompositionSegmentsProps {
  maxThumbSlots: number;
  minThumbnailWidth: number;
  thumbSlotPx: number;
}

export function drawTimelineClipCanvasCompositionSegmentThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
  props: DrawTimelineClipCanvasCompositionSegmentsProps,
): number {
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0 || w < props.minThumbnailWidth) return 0;

  let drawn = 0;
  for (const segment of segments) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    const segmentX = x + startNorm * w;
    const segmentW = Math.max(1, (endNorm - startNorm) * w);
    if (segmentW <= 0) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(segmentX, top, segmentW, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fillRect(segmentX, top, segmentW, h);

    if (segment.thumbnails.length > 0) {
      const urls = getTimelineClipCanvasCompositionThumbnailSlotUrls(
        segment.thumbnails,
        segmentW,
        props.thumbSlotPx,
        props.maxThumbSlots,
      );
      const count = urls.length;
      const slotW = segmentW / count;
      for (let index = 0; index < count; index += 1) {
        const url = urls[index];
        const bmp = getThumbnailBitmap(url);
        if (bmp) {
          drawTimelineClipCanvasCover(ctx, bmp, segmentX + index * slotW, top, slotW, h);
          drawn += 1;
        } else {
          ensureThumbnailBitmap(url, requestRedraw);
        }
      }
    }

    ctx.fillStyle = 'rgba(251, 146, 60, 0.18)';
    ctx.fillRect(segmentX, top, segmentW, h);
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(segmentX + 0.5, top + 0.5, Math.max(0, segmentW - 1), Math.max(0, h - 1));
    ctx.restore();
  }

  return drawn;
}
