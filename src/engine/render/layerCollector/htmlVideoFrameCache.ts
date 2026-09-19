import type { Layer } from '../../core/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { LayerCollectorDeps } from '../LayerCollector';

export type CachedHtmlVideoFrame = {
  view: GPUTextureView;
  width: number;
  height: number;
  mediaTime?: number;
};

export function getSafeLastFrameFallback(
  layer: Layer,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps,
  targetTime: number
): CachedHtmlVideoFrame | null {
  const isDragging = useTimelineStore.getState().isDraggingPlayhead;
  const tolerance = isDragging
    ? 0.35
    : deps.isPlaying
      ? 0.09
      : video.seeking
        ? 0.35
        : 0.2;
  const ownerMatched =
    deps.scrubbingCache?.getLastFrameNearTime(video, targetTime, tolerance, layer.sourceClipId) ?? null;
  if (ownerMatched) {
    return ownerMatched;
  }

  const cachedOwner = deps.scrubbingCache?.getLastFrameOwner?.(video);
  if (cachedOwner && layer.sourceClipId && cachedOwner !== layer.sourceClipId) {
    return null;
  }

  return deps.scrubbingCache?.getLastFrameNearTime(video, targetTime, tolerance) ?? null;
}

export function getDragHoldFrame(
  layer: Layer,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps
): CachedHtmlVideoFrame | null {
  if (!layer.sourceClipId) {
    return null;
  }
  return deps.scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null;
}

export function getPlaybackStallHoldFrame(
  layer: Layer,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps
): CachedHtmlVideoFrame | null {
  const ownerMatched = deps.scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null;
  if (ownerMatched) {
    return ownerMatched;
  }

  const cachedOwner = deps.scrubbingCache?.getLastFrameOwner?.(video);
  if (cachedOwner && layer.sourceClipId && cachedOwner !== layer.sourceClipId) {
    return null;
  }

  const lastFrame = deps.scrubbingCache?.getLastFrame(video) ?? null;
  return lastFrame;
}

export function scheduleBackgroundScrubPreload(
  video: HTMLVideoElement,
  targetTime: number,
  deps: LayerCollectorDeps,
  isDragging: boolean
): void {
  if (deps.isExporting) return;
  deps.scrubbingCache?.preloadAroundTime?.(video, targetTime, {
    isDragging,
    isPlaying: deps.isPlaying,
  });
}
