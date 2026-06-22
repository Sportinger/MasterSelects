import type { LayerRenderData } from '../../core/types';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { useTimelineStore } from '../../../stores/timeline';
import { MAX_DRAG_FALLBACK_DRIFT_SECONDS } from './constants';
import {
  getTargetVideoTime,
  isFrameNearTarget,
} from './collectionPredicates';
import {
  getDragHoldFrame,
  getPlaybackStallHoldFrame,
  getSafeLastFrameFallback,
  scheduleBackgroundScrubPreload,
} from './htmlVideoFrameCache';
import {
  filterPausedHtmlTargetFrame,
  shouldGuardPausedHtmlTargetFrames,
} from './htmlVideoPausedFrameGuard';
import type { HtmlVideoCollectRequest } from './htmlVideoCollector';

export function collectNotReadyHtmlVideo(
  request: HtmlVideoCollectRequest
): LayerRenderData | null {
  const { layer, video, deps, layerReuseKey, controller } = request;
  const targetTime = getTargetVideoTime(layer, video);
  const isDragging = useTimelineStore.getState().isDraggingPlayhead;
  scheduleBackgroundScrubPreload(video, targetTime, deps, isDragging);
  const cacheSearchDistanceFrames = isDragging ? 10 : 6;
  const isSettling = scrubSettleState.isPending(layer.sourceClipId);
  const shouldGuardPausedTargetFrames = shouldGuardPausedHtmlTargetFrames({
    isPlaying: deps.isPlaying,
    isDragging,
    isExporting: deps.isExporting,
  });
  const lastSameClipFrame = filterPausedHtmlTargetFrame(
    getDragHoldFrame(layer, video, deps),
    targetTime,
    shouldGuardPausedTargetFrames
  );
  const dragHoldFrame = isSettling
    ? (() => {
      const holdFrame = lastSameClipFrame;
      return isFrameNearTarget(
        holdFrame,
        targetTime,
        MAX_DRAG_FALLBACK_DRIFT_SECONDS
      )
        ? holdFrame
        : null;
    })()
    : null;
  const emergencyHoldFrame = isDragging
    ? (() => {
      const holdFrame = lastSameClipFrame;
      return isFrameNearTarget(
        holdFrame,
        targetTime,
        MAX_DRAG_FALLBACK_DRIFT_SECONDS
      )
        ? holdFrame
        : null;
    })()
    : dragHoldFrame;
  const sameClipHoldFrame =
    (isDragging || isSettling || video.seeking || video.readyState < 2)
      ? isFrameNearTarget(
        lastSameClipFrame,
        targetTime,
        isDragging
          ? MAX_DRAG_FALLBACK_DRIFT_SECONDS
          : 0.35
      )
        ? lastSameClipFrame
        : null
      : null;
  const safeFallback = filterPausedHtmlTargetFrame(
    getSafeLastFrameFallback(layer, video, deps, targetTime),
    targetTime,
    shouldGuardPausedTargetFrames
  ) ?? dragHoldFrame;
  const cachedFrame =
    deps.scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
    (shouldGuardPausedTargetFrames
      ? null
      : deps.scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames));
  const pausedTargetCachedFrame = filterPausedHtmlTargetFrame(
    cachedFrame,
    targetTime,
    shouldGuardPausedTargetFrames
  );
  if (pausedTargetCachedFrame) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'not-ready-scrub-cache', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: pausedTargetCachedFrame.view,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      displayedMediaTime: pausedTargetCachedFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'not-ready-scrub-cache',
    };
  }
  if (safeFallback) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'not-ready-cache', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: safeFallback.view,
      sourceWidth: safeFallback.width,
      sourceHeight: safeFallback.height,
      displayedMediaTime: safeFallback.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'not-ready-cache',
    };
  }
  if (emergencyHoldFrame) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'emergency-hold', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: emergencyHoldFrame.view,
      sourceWidth: emergencyHoldFrame.width,
      sourceHeight: emergencyHoldFrame.height,
      displayedMediaTime: emergencyHoldFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'emergency-hold',
    };
  }
  if (sameClipHoldFrame) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'same-clip-hold', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: sameClipHoldFrame.view,
      sourceWidth: sameClipHoldFrame.width,
      sourceHeight: sameClipHoldFrame.height,
      displayedMediaTime: sameClipHoldFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'same-clip-hold',
    };
  }
  if (deps.isPlaying) {
    const anyFrame = getPlaybackStallHoldFrame(layer, video, deps, targetTime);
    if (anyFrame) {
      controller.traceScrubPath(layer, 'playback-stall-hold', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
      controller.setDecoder('HTMLVideo(cached)');
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: anyFrame.view,
        sourceWidth: anyFrame.width,
        sourceHeight: anyFrame.height,
        displayedMediaTime: anyFrame.mediaTime,
        targetMediaTime: targetTime,
        previewPath: 'playback-stall-hold',
      };
    }
  }
  controller.traceScrubPath(layer, 'not-ready-drop', video, targetTime, deps.scrubbingCache?.getLastPresentedTime(video));
  return null;
}
