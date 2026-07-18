import { hasThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  getTimelineClipCanvasCompositionThumbnailSlotUrls,
  TIMELINE_CLIP_CANVAS_COMPOSITION_SEGMENT_MAX_COUNT,
} from './timelineClipCanvasCompositionResource';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import {
  TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT,
  TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH,
  type TimelineClipCanvasWorkerThumbnailStripPlan,
} from './timelineClipCanvasThumbnailResource';

export interface TimelineClipCanvasWorkerThumbnailPreparation {
  handledClipIds: ReadonlySet<string>;
  plansByClipId: ReadonlyMap<string, TimelineClipCanvasWorkerThumbnailStripPlan>;
  visibleBitmapClipIds: ReadonlySet<string>;
  missingBitmapRefs: readonly { url: string; mediaFileId?: string }[];
}

export function getTimelineClipCanvasThumbnailMediaFileId(clip: TimelinePaintSourceClip): string | null {
  if (clip.source?.type !== 'video' && clip.source?.type !== 'image') return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

export function collectTimelineClipCanvasWorkerThumbnailPreparation(input: {
  clips: readonly TimelinePaintSourceClip[];
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  renderOverscanPx: number;
  thumbnailViewportOverscanPx: number;
  minThumbnailWidth: number;
  thumbnailSlotPx: number;
  maxThumbnailSlots: number;
  mediaThumbnailUrlsById?: ReadonlyMap<string, string | undefined>;
}): TimelineClipCanvasWorkerThumbnailPreparation {
  const handledClipIds = new Set<string>();
  const plansByClipId = new Map<string, TimelineClipCanvasWorkerThumbnailStripPlan>();
  const visibleBitmapClipIds = new Set<string>();
  const missingBitmapRefsByUrl = new Map<string, { url: string; mediaFileId?: string }>();
  const thumbVisibleLeft = input.scrollX - input.thumbnailViewportOverscanPx;
  const thumbVisibleRight = input.scrollX + input.viewportWidth + input.thumbnailViewportOverscanPx;
  const renderVisibleLeft = input.scrollX - input.renderOverscanPx;
  const renderVisibleRight = input.scrollX + input.viewportWidth + input.renderOverscanPx;
  const h = Math.max(1, input.height - 2);

  for (const clip of input.clips) {
    if (clip.clipSegments?.length) {
      const geometry = input.resolveGeometry(clip);
      if (geometry.visible) {
        const absoluteX = input.timeToPixel(geometry.startTime);
        const absoluteW = input.timeToPixel(geometry.duration);
        const absoluteRight = absoluteX + absoluteW;
        const visibleAbsLeft = Math.max(absoluteX, input.canvasOffsetX, renderVisibleLeft);
        const visibleAbsRight = Math.min(absoluteRight, input.canvasOffsetX + input.cssWidth, renderVisibleRight);
        const visibleW = visibleAbsRight - visibleAbsLeft;
        const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
        if (absoluteW > 0 && visibleW >= input.minThumbnailWidth && inThumbWindow) {
          clip.clipSegments.slice(0, TIMELINE_CLIP_CANVAS_COMPOSITION_SEGMENT_MAX_COUNT).forEach((segment) => {
            const startNorm = Math.max(0, Math.min(1, segment.startNorm));
            const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
            const segmentWidth = Math.max(1, (endNorm - startNorm) * absoluteW);
            getTimelineClipCanvasCompositionThumbnailSlotUrls(
              segment.thumbnails,
              segmentWidth,
              input.thumbnailSlotPx,
              input.maxThumbnailSlots,
            ).forEach((url) => {
              if (!url) return;
              if (hasThumbnailBitmap(url)) {
                visibleBitmapClipIds.add(clip.id);
                return;
              }
              missingBitmapRefsByUrl.set(url, { url, mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId });
            });
          });
        }
      }
    }

    const mediaFileId = getTimelineClipCanvasThumbnailMediaFileId(clip);
    if (!mediaFileId) continue;
    if (clip.isComposition && clip.clipSegments?.length) continue;

    const geometry = input.resolveGeometry(clip);
    if (!geometry.visible) {
      handledClipIds.add(clip.id);
      continue;
    }

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    const absoluteRight = absoluteX + absoluteW;
    if (absoluteW <= 0) {
      handledClipIds.add(clip.id);
      continue;
    }

    const visibleAbsLeft = Math.max(absoluteX, input.canvasOffsetX, renderVisibleLeft);
    const visibleAbsRight = Math.min(absoluteRight, input.canvasOffsetX + input.cssWidth, renderVisibleRight);
    const visibleW = visibleAbsRight - visibleAbsLeft;
    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    if (visibleW < input.minThumbnailWidth || !inThumbWindow) {
      handledClipIds.add(clip.id);
      continue;
    }

    const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
    const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
    const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
    const visibleInPoint = geometry.inPoint + sourceSpan * visibleStartRatio;
    const visibleOutPoint = geometry.inPoint + sourceSpan * visibleEndRatio;
    const count = Math.max(1, Math.min(input.maxThumbnailSlots, Math.floor(visibleW / input.thumbnailSlotPx)));
    const staticThumbnailUrl = clip.source?.type === 'image'
      ? input.mediaThumbnailUrlsById?.get(mediaFileId)
      : undefined;
    const urls = staticThumbnailUrl
      ? Array.from({ length: count }, () => staticThumbnailUrl)
      : thumbnailCacheService.getThumbnailsForRange(
        mediaFileId,
        visibleInPoint,
        visibleOutPoint,
        count,
        clip.reversed,
      );
    if (!urls.some((url) => Boolean(url))) {
      handledClipIds.add(clip.id);
      continue;
    }
    let hasMissingBitmap = false;
    urls.forEach((url) => {
      if (!url) return;
      if (hasThumbnailBitmap(url)) {
        visibleBitmapClipIds.add(clip.id);
        return;
      }
      hasMissingBitmap = true;
      missingBitmapRefsByUrl.set(url, { url, mediaFileId });
    });
    if (hasMissingBitmap) {
      handledClipIds.add(clip.id);
      continue;
    }

    handledClipIds.add(clip.id);
    plansByClipId.set(clip.id, {
      clipId: clip.id,
      mediaFileId,
      x: visibleAbsLeft - input.canvasOffsetX,
      width: visibleW,
      height: h,
      bitmapWidth: Math.max(1, Math.min(TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH, Math.round(visibleW))),
      bitmapHeight: Math.max(1, Math.min(TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT, Math.round(h))),
      urls,
    });
  }

  return {
    handledClipIds,
    plansByClipId,
    visibleBitmapClipIds,
    missingBitmapRefs: [...missingBitmapRefsByUrl.values()],
  };
}
