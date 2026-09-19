import { useEffect, useMemo, useRef } from 'react';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import { flockThumbnailService } from '../../../services/flock/flockThumbnailService';
import { useTimelineStore } from '../../../stores/timeline';
import { ensureThumbnailBitmap } from '../../../services/timeline/thumbnailBitmapCache';
import {
  collectVisibleTimelineThumbnailRefs,
  scheduleVisibleTimelineThumbnailDbWarmup,
  type VisibleTimelineThumbnailRef,
} from '../../../services/timeline/timelineThumbnailDbWarmup';
import { scheduleVisibleTimelineThumbnailGeneration } from '../../../services/timeline/timelineThumbnailGenerationWarmup';
import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  collectTimelineClipCanvasVisibleThumbnailSecondRanges,
  timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges,
  type TimelineClipCanvasVisibleThumbnailSecondRangeMap,
} from '../utils/timelineClipCanvasVisibleArtifactCollection';
import type { TimelineClipCanvasWorkerThumbnailPreparation } from '../utils/timelineClipCanvasThumbnailPreparation';
import type { TimelineClipCanvasTrimGeometry } from '../utils/timelineClipCanvasTrimResource';

interface TimelineClipCanvasThumbnailWarmupMediaFile {
  id: string;
  fileHash?: string;
}

interface TimelineClipCanvasThumbnailWarmupsInput {
  clips: readonly TimelinePaintSourceClip[];
  mediaFiles: readonly TimelineClipCanvasThumbnailWarmupMediaFile[];
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  resolveGeometry: (clip: TimelinePaintSourceClip) => TimelineClipCanvasTrimGeometry;
  thumbnailViewportOverscanPx: number;
  missingBitmapRefs: TimelineClipCanvasWorkerThumbnailPreparation['missingBitmapRefs'];
  requestRedraw: () => void;
}

export function useTimelineClipCanvasThumbnailWarmups(
  input: TimelineClipCanvasThumbnailWarmupsInput,
): void {
  const {
    clips,
    mediaFiles,
    scrollX,
    viewportWidth,
    timeToPixel,
    resolveGeometry,
    thumbnailViewportOverscanPx,
    missingBitmapRefs,
    requestRedraw,
  } = input;
  const thumbnailRedrawRafRef = useRef<number | null>(null);
  const visibleThumbnailSecondRangesRef = useRef<TimelineClipCanvasVisibleThumbnailSecondRangeMap>(new Map());

  const mediaFileHashById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const file of mediaFiles) {
      map.set(file.id, file.fileHash);
    }
    return map;
  }, [mediaFiles]);
  const visibleThumbnailRefs = useMemo<VisibleTimelineThumbnailRef[]>(() => {
    return collectVisibleTimelineThumbnailRefs({
      clips,
      scrollX,
      viewportWidth,
      overscanPx: thumbnailViewportOverscanPx,
      timeToPixel,
      mediaFileHashById,
    });
  }, [clips, mediaFileHashById, scrollX, thumbnailViewportOverscanPx, timeToPixel, viewportWidth]);
  const visibleThumbnailSecondRanges = useMemo(
    () => collectTimelineClipCanvasVisibleThumbnailSecondRanges({
      clips,
      scrollX,
      viewportWidth,
      timeToPixel,
      resolveGeometry,
      thumbnailViewportOverscanPx,
    }),
    [clips, resolveGeometry, scrollX, thumbnailViewportOverscanPx, timeToPixel, viewportWidth],
  );

  const storeClips = useTimelineStore((state) => state.clips);
  const clipKeyframes = useTimelineStore((state) => state.clipKeyframes);
  const timelineBusy = useTimelineStore((state) => state.isPlaying === true || state.isExporting === true);
  const flockClipIds = useMemo(
    () => new Set(clips.filter((clip) => clip.source?.type === 'flock').map((clip) => clip.id)),
    [clips],
  );

  useEffect(() => {
    flockThumbnailService.setBusy(timelineBusy);
  }, [timelineBusy]);

  useEffect(() => {
    if (flockClipIds.size === 0) return;
    for (const clip of storeClips ?? []) {
      if (!flockClipIds.has(clip.id) || !clip.flock) continue;
      flockThumbnailService.request(clip, clipKeyframes?.get(clip.id));
    }
  }, [clipKeyframes, flockClipIds, storeClips]);

  useEffect(() => {
    if (flockClipIds.size === 0) return;
    return flockThumbnailService.subscribe(requestRedraw);
  }, [flockClipIds, requestRedraw]);

  useEffect(() => {
    if (missingBitmapRefs.length === 0) return;
    missingBitmapRefs.forEach(({ url, mediaFileId }) => {
      ensureThumbnailBitmap(url, requestRedraw, mediaFileId);
    });
  }, [missingBitmapRefs, requestRedraw]);

  useEffect(() => {
    visibleThumbnailSecondRangesRef.current = visibleThumbnailSecondRanges;
  }, [visibleThumbnailSecondRanges]);

  useEffect(() => {
    const unsubscribe = thumbnailCacheService.subscribe((mediaFileId, _status, event) => {
      if (!timelineClipCanvasThumbnailCacheEventIntersectsVisibleRanges(mediaFileId, event, visibleThumbnailSecondRangesRef.current)) return;
      if (thumbnailRedrawRafRef.current !== null) return;
      thumbnailRedrawRafRef.current = requestAnimationFrame(() => {
        thumbnailRedrawRafRef.current = null;
        requestRedraw();
      });
    });
    return () => {
      unsubscribe();
      if (thumbnailRedrawRafRef.current !== null) {
        cancelAnimationFrame(thumbnailRedrawRafRef.current);
        thumbnailRedrawRafRef.current = null;
      }
    };
  }, [requestRedraw]);

  useEffect(() => {
    if (visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailDbWarmup(visibleThumbnailRefs);
  }, [visibleThumbnailRefs]);

  useEffect(() => {
    if (visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailGeneration(visibleThumbnailRefs);
  }, [visibleThumbnailRefs]);
}
