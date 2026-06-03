import type { ClipSegment } from '../../../types';
import type { TimelineHorizontalRenderWindow } from './waveformRenderGeometry';

export interface ThumbnailCacheEligibility {
  sourceMediaFileId?: string;
  isCompositionWithSegments: boolean;
  useSourceCache: boolean;
}

export interface ThumbnailDisplayPlan {
  showSegmentThumbnails: boolean;
  showRegularThumbnails: boolean;
}

export interface SegmentThumbnailRenderPlan {
  segmentIndex: number;
  segment: ClipSegment;
  leftPercent: number;
  widthPercent: number;
  thumbnailIndexes: number[];
}

export interface LegacyThumbnailRenderPlan {
  slotIndex: number;
  thumbnailIndex: number;
  thumbnail: string;
}

export function resolveVisibleThumbCount(
  renderWindow: TimelineHorizontalRenderWindow,
  thumbWidth: number,
): number {
  return renderWindow.width > 0
    ? Math.max(1, Math.ceil(renderWindow.width / Math.max(1, thumbWidth)) + 1)
    : 0;
}

export function resolveThumbnailCacheEligibility(input: {
  passiveMediaEnabled: boolean;
  sourceType?: string;
  sourceMediaFileId?: string;
  isComposition?: boolean;
  clipSegments?: readonly ClipSegment[];
}): ThumbnailCacheEligibility {
  const isCompositionWithSegments = Boolean(input.isComposition && input.clipSegments && input.clipSegments.length > 0);
  const useSourceCache = Boolean(
    input.passiveMediaEnabled &&
    input.sourceType === 'video' &&
    input.sourceMediaFileId &&
    !isCompositionWithSegments,
  );

  return {
    sourceMediaFileId: input.sourceMediaFileId,
    isCompositionWithSegments,
    useSourceCache,
  };
}

export function resolveThumbnailDisplayPlan(input: {
  passiveMediaEnabled: boolean;
  thumbnailsEnabled: boolean;
  isAudioClip: boolean;
  showsStaticClipArtwork: boolean;
  isComposition?: boolean;
  compositionSegmentCount: number;
  isCompositionWithSegments: boolean;
  useSourceCache: boolean;
  hasCachedSourceThumbnails: boolean;
  legacyThumbnailCount: number;
}): ThumbnailDisplayPlan {
  const canShowPassiveThumbnails = input.passiveMediaEnabled &&
    input.thumbnailsEnabled &&
    !input.isAudioClip &&
    !input.showsStaticClipArtwork;

  return {
    showSegmentThumbnails: Boolean(
      canShowPassiveThumbnails &&
      input.isComposition &&
      input.compositionSegmentCount > 0,
    ),
    showRegularThumbnails: Boolean(
      canShowPassiveThumbnails &&
      !input.isCompositionWithSegments &&
      (input.useSourceCache ? input.hasCachedSourceThumbnails : input.legacyThumbnailCount > 0),
    ),
  };
}

export function resolveSegmentThumbnailRenderPlans(input: {
  segments: readonly ClipSegment[];
  renderWindow: TimelineHorizontalRenderWindow;
  clipWidth: number;
  visibleThumbs: number;
  thumbWidth: number;
}): SegmentThumbnailRenderPlan[] {
  if (input.segments.length === 0 || input.renderWindow.width <= 0 || input.clipWidth <= 0) return [];

  const windowStartNorm = input.renderWindow.startPx / Math.max(1, input.clipWidth);
  const windowEndNorm = (input.renderWindow.startPx + input.renderWindow.width) / Math.max(1, input.clipWidth);
  const windowNormSpan = Math.max(0.0001, windowEndNorm - windowStartNorm);

  return input.segments.flatMap((segment, segmentIndex) => {
    if (segment.endNorm < windowStartNorm || segment.startNorm > windowEndNorm) return [];

    const clippedSegmentStart = Math.max(segment.startNorm, windowStartNorm);
    const clippedSegmentEnd = Math.min(segment.endNorm, windowEndNorm);
    const widthPercent = ((clippedSegmentEnd - clippedSegmentStart) / windowNormSpan) * 100;
    const leftPercent = ((clippedSegmentStart - windowStartNorm) / windowNormSpan) * 100;
    const thumbCount = Math.max(1, Math.min(
      input.visibleThumbs,
      Math.ceil(((clippedSegmentEnd - clippedSegmentStart) * input.clipWidth) / Math.max(1, input.thumbWidth)) + 1,
    ));
    const thumbnailIndexes = segment.thumbnails.length > 0
      ? Array.from({ length: thumbCount }, (_, index) => {
          const thumbnailIndex = Math.floor((index / thumbCount) * segment.thumbnails.length);
          return Math.min(thumbnailIndex, segment.thumbnails.length - 1);
        })
      : [];

    return [{
      segmentIndex,
      segment,
      leftPercent,
      widthPercent,
      thumbnailIndexes,
    }];
  });
}

export function resolveLegacyThumbnailRenderPlans(input: {
  thumbnails: readonly string[];
  visibleThumbs: number;
  renderWindow: TimelineHorizontalRenderWindow;
  clipWidth: number;
  displayInPoint: number;
  displayOutPoint: number;
  naturalDuration: number;
  thumbWidth: number;
}): LegacyThumbnailRenderPlan[] {
  if (input.thumbnails.length === 0 || input.visibleThumbs <= 0) return [];

  const naturalDuration = Math.max(0.001, input.naturalDuration);
  const startRatio = input.displayInPoint / naturalDuration;
  const endRatio = input.displayOutPoint / naturalDuration;

  return Array.from({ length: input.visibleThumbs }, (_, slotIndex) => {
    const positionInTrimmed = Math.min(1, Math.max(
      0,
      (input.renderWindow.startPx + slotIndex * input.thumbWidth) / Math.max(1, input.clipWidth),
    ));
    const sourceRatio = startRatio + positionInTrimmed * (endRatio - startRatio);
    const thumbnailIndex = Math.floor(sourceRatio * input.thumbnails.length);
    const clampedIndex = Math.min(Math.max(0, thumbnailIndex), input.thumbnails.length - 1);

    return {
      slotIndex,
      thumbnailIndex: clampedIndex,
      thumbnail: input.thumbnails[clampedIndex],
    };
  });
}
