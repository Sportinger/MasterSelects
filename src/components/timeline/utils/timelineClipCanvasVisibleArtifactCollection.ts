import type { ThumbnailCacheEvent } from '../../../services/thumbnailCacheService';
import type { TimelinePaintSourceClip } from '../../../timeline';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import { getTimelineClipCanvasThumbnailMediaFileId } from './timelineClipCanvasThumbnailPreparation';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';

export interface TimelineClipCanvasVisibleThumbnailSecondRange {
  startSecond: number;
  endSecond: number;
}

export type TimelineClipCanvasVisibleThumbnailSecondRangeMap = Map<
  string,
  TimelineClipCanvasVisibleThumbnailSecondRange[]
>;

function addTimelineClipCanvasVisibleThumbnailSecondRange(
  rangesByMediaId: TimelineClipCanvasVisibleThumbnailSecondRangeMap,
  mediaFileId: string,
  startSecond: number,
  endSecond: number,
): void {
  const normalizedRange = {
    startSecond: Math.max(0, Math.floor(Math.min(startSecond, endSecond))),
    endSecond: Math.max(0, Math.ceil(Math.max(startSecond, endSecond))),
  };
  const ranges = rangesByMediaId.get(mediaFileId);
  if (ranges) {
    ranges.push(normalizedRange);
    return;
  }
  rangesByMediaId.set(mediaFileId, [normalizedRange]);
}

export function collectTimelineClipCanvasVisibleThumbnailSecondRanges(input: {
  clips: readonly TimelinePaintSourceClip[];
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  thumbnailViewportOverscanPx: number;
}): TimelineClipCanvasVisibleThumbnailSecondRangeMap {
  const rangesByMediaId: TimelineClipCanvasVisibleThumbnailSecondRangeMap = new Map();
  const visibleLeft = input.scrollX - input.thumbnailViewportOverscanPx;
  const visibleRight = input.scrollX + input.viewportWidth + input.thumbnailViewportOverscanPx;

  for (const clip of input.clips) {
    const geometry = input.resolveGeometry(clip);
    if (!geometry.visible) continue;

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    if (absoluteW <= 0) continue;

    const overlapLeft = Math.max(absoluteX, visibleLeft);
    const overlapRight = Math.min(absoluteX + absoluteW, visibleRight);
    if (overlapRight <= overlapLeft) continue;

    const overlapStartRatio = Math.max(0, Math.min(1, (overlapLeft - absoluteX) / absoluteW));
    const overlapEndRatio = Math.max(0, Math.min(1, (overlapRight - absoluteX) / absoluteW));
    const mediaFileId = getTimelineClipCanvasThumbnailMediaFileId(clip);
    if (mediaFileId) {
      const sourceDuration = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const sourceStart = geometry.inPoint + overlapStartRatio * sourceDuration;
      const sourceEnd = geometry.inPoint + overlapEndRatio * sourceDuration;
      addTimelineClipCanvasVisibleThumbnailSecondRange(rangesByMediaId, mediaFileId, sourceStart - 1, sourceEnd + 1);
    }

    const compositionSegments = clip.trackType === 'audio' || clip.source?.type === 'audio'
      ? []
      : clip.clipSegments ?? [];
    for (const segment of compositionSegments) {
      if (
        !segment.mediaFileId ||
        !Number.isFinite(segment.sourceInPoint) ||
        !Number.isFinite(segment.sourceOutPoint)
      ) {
        continue;
      }
      const segmentStartNorm = Math.max(0, Math.min(1, segment.startNorm));
      const segmentEndNorm = Math.max(segmentStartNorm, Math.min(1, segment.endNorm));
      const visibleSegmentStartNorm = Math.max(segmentStartNorm, overlapStartRatio);
      const visibleSegmentEndNorm = Math.min(segmentEndNorm, overlapEndRatio);
      if (visibleSegmentEndNorm <= visibleSegmentStartNorm) continue;

      const segmentNormDuration = Math.max(0.000001, segmentEndNorm - segmentStartNorm);
      const sourceDuration = segment.sourceOutPoint! - segment.sourceInPoint!;
      const sourceStart = segment.sourceInPoint!
        + ((visibleSegmentStartNorm - segmentStartNorm) / segmentNormDuration) * sourceDuration;
      const sourceEnd = segment.sourceInPoint!
        + ((visibleSegmentEndNorm - segmentStartNorm) / segmentNormDuration) * sourceDuration;
      addTimelineClipCanvasVisibleThumbnailSecondRange(
        rangesByMediaId,
        segment.mediaFileId,
        sourceStart - 1,
        sourceEnd + 1,
      );
    }
  }

  return rangesByMediaId;
}

export function collectTimelineClipCanvasVisibleAudioArtifactClipIds(input: {
  clips: readonly TimelinePaintSourceClip[];
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  thumbnailViewportOverscanPx: number;
}): readonly string[] {
  const ids: string[] = [];
  const visibleLeft = input.scrollX - input.thumbnailViewportOverscanPx;
  const visibleRight = input.scrollX + input.viewportWidth + input.thumbnailViewportOverscanPx;

  for (const clip of input.clips) {
    if (!isTimelineClipCanvasAudioClip(clip)) continue;

    const geometry = input.resolveGeometry(clip);
    if (!geometry.visible) continue;

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    if (absoluteW <= 0) continue;
    if (absoluteX + absoluteW < visibleLeft || absoluteX > visibleRight) continue;

    ids.push(clip.id);
  }

  return ids;
}

function getTimelineClipCanvasThumbnailCacheEventSeconds(event: ThumbnailCacheEvent | undefined): readonly number[] | null {
  if (!event) return null;
  if (event.secondIndices && event.secondIndices.length > 0) return event.secondIndices;
  return typeof event.secondIndex === 'number' ? [event.secondIndex] : null;
}

export function timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges(
  mediaFileId: string,
  event: ThumbnailCacheEvent | undefined,
  visibleRangesByMediaId: TimelineClipCanvasVisibleThumbnailSecondRangeMap,
): boolean {
  const ranges = visibleRangesByMediaId.get(mediaFileId);
  if (!ranges || ranges.length === 0) return false;

  const changedSeconds = getTimelineClipCanvasThumbnailCacheEventSeconds(event);
  if (!changedSeconds) return true;

  return changedSeconds.some((secondIndex) => (
    ranges.some((range) => secondIndex >= range.startSecond && secondIndex <= range.endSecond)
  ));
}
