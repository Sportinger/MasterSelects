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

// Only live imports refresh the last-frame slot; scrub-cache frames do not.
// A hold must still prefer the cached frame nearest the target (usually the
// one just displayed), or a 4K scrub/playback stall flashes back to an older
// live capture.
const HOLD_CACHE_SEARCH_FRAMES = 30;

function preferNearerCachedHoldFrame(
  frame: CachedHtmlVideoFrame | null,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps,
  targetTime: number | undefined
): CachedHtmlVideoFrame | null {
  if (targetTime === undefined || !Number.isFinite(targetTime)) return frame;
  const frameDistance = frame?.mediaTime === undefined
    ? Number.POSITIVE_INFINITY
    : Math.abs(frame.mediaTime - targetTime);
  if (frameDistance <= 1 / 60) return frame;
  const cached = deps.scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, HOLD_CACHE_SEARCH_FRAMES);
  if (!cached || Math.abs(cached.mediaTime - targetTime) >= frameDistance) return frame;
  return { view: cached.view, width: video.videoWidth, height: video.videoHeight, mediaTime: cached.mediaTime };
}

export function getDragHoldFrame(
  layer: Layer,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps,
  targetTime?: number
): CachedHtmlVideoFrame | null {
  if (!layer.sourceClipId) {
    return null;
  }
  const lastFrame = deps.scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null;
  return preferNearerCachedHoldFrame(lastFrame, video, deps, targetTime);
}

export function getPlaybackStallHoldFrame(
  layer: Layer,
  video: HTMLVideoElement,
  deps: LayerCollectorDeps,
  targetTime?: number
): CachedHtmlVideoFrame | null {
  const ownerMatched = deps.scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null;
  if (ownerMatched) {
    return preferNearerCachedHoldFrame(ownerMatched, video, deps, targetTime);
  }

  const cachedOwner = deps.scrubbingCache?.getLastFrameOwner?.(video);
  if (cachedOwner && layer.sourceClipId && cachedOwner !== layer.sourceClipId) {
    return null;
  }

  const lastFrame = deps.scrubbingCache?.getLastFrame(video) ?? null;
  return preferNearerCachedHoldFrame(lastFrame, video, deps, targetTime);
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
