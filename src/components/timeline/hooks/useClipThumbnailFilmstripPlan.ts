import { useMemo } from 'react';
import type { ClipSegment, TimelineClip } from '../../../types';
import { useThumbnailCache } from '../../../hooks/useThumbnailCache';
import { THUMB_WIDTH } from '../constants';
import {
  resolveHorizontalRenderWindow,
  resolveVisibleSourceWindow,
  type TimelineHorizontalRenderWindow,
} from '../utils/waveformRenderGeometry';
import {
  resolveLegacyThumbnailRenderPlans,
  resolveSegmentThumbnailRenderPlans,
  resolveThumbnailCacheEligibility,
  resolveThumbnailDisplayPlan,
  resolveVisibleThumbCount,
  type LegacyThumbnailRenderPlan,
  type SegmentThumbnailRenderPlan,
} from '../utils/thumbnailFilmstrip';

const THUMBNAIL_RENDER_OVERSCAN_PX = THUMB_WIDTH * 3;
const EMPTY_LEGACY_THUMBNAILS: readonly string[] = [];
const EMPTY_COMPOSITION_SEGMENTS: readonly ClipSegment[] = [];

export interface ClipThumbnailFilmstripPlan {
  thumbnailRenderWindow: TimelineHorizontalRenderWindow;
  showSegmentThumbnails: boolean;
  showRegularThumbnails: boolean;
  useSourceCache: boolean;
  cachedThumbnails: (string | null)[];
  segmentThumbnailPlans: SegmentThumbnailRenderPlan[];
  legacyThumbnailPlans: LegacyThumbnailRenderPlan[];
}

export function useClipThumbnailFilmstripPlan(input: {
  clip: TimelineClip;
  passiveMediaEnabled: boolean;
  thumbnailsEnabled: boolean;
  isAudioClip: boolean;
  showsStaticClipArtwork: boolean;
  scrollX: number;
  contentLeft: number;
  width: number;
  viewportWidth: number;
  displayInPoint: number;
  displayOutPoint: number;
}): ClipThumbnailFilmstripPlan {
  const thumbnailRenderWindow = useMemo(() => (
    resolveHorizontalRenderWindow({
      scrollX: input.scrollX,
      contentLeft: input.contentLeft,
      contentWidth: input.width,
      viewportWidth: input.viewportWidth,
      overscanPx: THUMBNAIL_RENDER_OVERSCAN_PX,
    })
  ), [input.contentLeft, input.scrollX, input.viewportWidth, input.width]);
  const thumbnailVisibleSourceWindow = useMemo(() => (
    resolveVisibleSourceWindow({
      inPoint: input.displayInPoint,
      outPoint: input.displayOutPoint,
      clipWidth: input.width,
      renderWindow: thumbnailRenderWindow,
    })
  ), [input.displayInPoint, input.displayOutPoint, input.width, thumbnailRenderWindow]);
  const sourceMediaFileId = input.clip.source?.mediaFileId || input.clip.mediaFileId;
  const thumbnailCacheEligibility = resolveThumbnailCacheEligibility({
    passiveMediaEnabled: input.passiveMediaEnabled,
    sourceType: input.clip.source?.type,
    sourceMediaFileId,
    isComposition: input.clip.isComposition,
    clipSegments: input.clip.clipSegments,
  });
  const visibleThumbs = resolveVisibleThumbCount(thumbnailRenderWindow, THUMB_WIDTH);
  const useSourceCache = thumbnailCacheEligibility.useSourceCache;
  const cachedThumbnails = useThumbnailCache(
    useSourceCache ? sourceMediaFileId : undefined,
    thumbnailVisibleSourceWindow.inPoint,
    thumbnailVisibleSourceWindow.outPoint,
    visibleThumbs,
    input.clip.reversed,
  );
  const legacyThumbnails = input.clip.thumbnails ?? EMPTY_LEGACY_THUMBNAILS;
  const compositionSegments = input.clip.clipSegments ?? EMPTY_COMPOSITION_SEGMENTS;
  const thumbnailDisplayPlan = resolveThumbnailDisplayPlan({
    passiveMediaEnabled: input.passiveMediaEnabled,
    thumbnailsEnabled: input.thumbnailsEnabled,
    isAudioClip: input.isAudioClip,
    showsStaticClipArtwork: input.showsStaticClipArtwork,
    isComposition: input.clip.isComposition,
    compositionSegmentCount: compositionSegments.length,
    isCompositionWithSegments: thumbnailCacheEligibility.isCompositionWithSegments,
    useSourceCache,
    hasCachedSourceThumbnails: cachedThumbnails.some(Boolean),
    legacyThumbnailCount: legacyThumbnails.length,
  });
  const showSegmentThumbnails = thumbnailDisplayPlan.showSegmentThumbnails;
  const showRegularThumbnails = thumbnailDisplayPlan.showRegularThumbnails;
  const segmentThumbnailPlans = useMemo(() => (
    showSegmentThumbnails
      ? resolveSegmentThumbnailRenderPlans({
          segments: compositionSegments,
          renderWindow: thumbnailRenderWindow,
          clipWidth: input.width,
          visibleThumbs,
          thumbWidth: THUMB_WIDTH,
        })
      : []
  ), [compositionSegments, input.width, showSegmentThumbnails, thumbnailRenderWindow, visibleThumbs]);
  const legacyThumbnailPlans = useMemo(() => (
    showRegularThumbnails && !useSourceCache
      ? resolveLegacyThumbnailRenderPlans({
          thumbnails: legacyThumbnails,
          visibleThumbs,
          renderWindow: thumbnailRenderWindow,
          clipWidth: input.width,
          displayInPoint: input.displayInPoint,
          displayOutPoint: input.displayOutPoint,
          naturalDuration: input.clip.source?.naturalDuration || input.clip.duration,
          thumbWidth: THUMB_WIDTH,
        })
      : []
  ), [
    input.clip.duration,
    input.clip.source?.naturalDuration,
    input.displayInPoint,
    input.displayOutPoint,
    input.width,
    legacyThumbnails,
    showRegularThumbnails,
    thumbnailRenderWindow,
    useSourceCache,
    visibleThumbs,
  ]);

  return {
    thumbnailRenderWindow,
    showSegmentThumbnails,
    showRegularThumbnails,
    useSourceCache,
    cachedThumbnails,
    segmentThumbnailPlans,
    legacyThumbnailPlans,
  };
}
