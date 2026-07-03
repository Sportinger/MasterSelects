import type { LayerRenderData } from '../../core/types';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { useTimelineStore } from '../../../stores/timeline';
import {
  MAX_DRAG_FALLBACK_DRIFT_SECONDS,
  MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS,
} from './constants';
import {
  getTargetVideoTime,
  isFrameNearTarget,
  isPlaybackHtmlLiveFrameUsable,
} from './collectionPredicates';
import {
  getDragHoldFrame,
  getPlaybackStallHoldFrame,
  getSafeLastFrameFallback,
  scheduleBackgroundScrubPreload,
} from './htmlVideoFrameCache';
import {
  filterPausedHtmlTargetFrame,
  isPausedHtmlTargetMediaTimeUsable,
  shouldGuardPausedHtmlTargetFrames,
} from './htmlVideoPausedFrameGuard';
import { collectExportHtmlVideo } from './htmlVideoExportCollector';
import type { HtmlVideoCollectRequest } from './htmlVideoCollector';

const PLAYBACK_CACHE_CAPTURE_INTERVAL_MS = 2000;

export function collectReadyHtmlVideo(
  request: HtmlVideoCollectRequest
): LayerRenderData | null {
  const { layer, video, deps, options, videoKey, layerReuseKey, controller } = request;
  const currentTime = video.currentTime;
  const targetTime = getTargetVideoTime(layer, video);

  if (deps.isExporting) {
    const exportFrame = collectExportHtmlVideo(request, currentTime, targetTime);
    if (exportFrame) {
      return exportFrame;
    }
  }

  const isDragging = useTimelineStore.getState().isDraggingPlayhead;
  scheduleBackgroundScrubPreload(video, targetTime, deps, isDragging);
  const settle = scrubSettleState.get(layer.sourceClipId);
  const isSettling = !!settle;
  const isPausedSettle = !deps.isPlaying && !isDragging && isSettling;
  const shouldGuardPausedTargetFrames = shouldGuardPausedHtmlTargetFrames({
    isPlaying: deps.isPlaying,
    isDragging,
    isExporting: deps.isExporting,
  });
  const lastPresentedTime = deps.scrubbingCache?.getLastPresentedTime(video);
  const lastPresentedOwner = deps.scrubbingCache?.getLastPresentedOwner(video);
  const hasPresentedOwnerMismatch =
    !!layer.sourceClipId &&
    !!lastPresentedOwner &&
    lastPresentedOwner !== layer.sourceClipId;
  const hasConfirmedPresentedFrame =
    !hasPresentedOwnerMismatch &&
    typeof lastPresentedTime === 'number' &&
    Number.isFinite(lastPresentedTime);
  const displayedTime = hasConfirmedPresentedFrame ? lastPresentedTime : undefined;
  const hasFreshPresentedFrame =
    hasConfirmedPresentedFrame &&
    (shouldGuardPausedTargetFrames
      ? isPausedHtmlTargetMediaTimeUsable(lastPresentedTime, targetTime)
      : Math.abs(lastPresentedTime - targetTime) <= 0.12);
  const presentedDriftSeconds = hasConfirmedPresentedFrame
    ? Math.abs(lastPresentedTime - targetTime)
    : undefined;
  const currentTimeDriftSeconds = Math.abs(currentTime - targetTime);
  const hasStablePausedHtmlFrame =
    !deps.isPlaying &&
    !isDragging &&
    !isSettling &&
    !video.seeking &&
    Number.isFinite(currentTime) &&
    (shouldGuardPausedTargetFrames
      ? isPausedHtmlTargetMediaTimeUsable(currentTime, targetTime)
      : currentTimeDriftSeconds <= 0.12);
  const reportedDisplayedTime =
    Number.isFinite(currentTime) &&
    ((deps.isPlaying && !video.paused && !video.seeking) || hasStablePausedHtmlFrame)
      ? currentTime
      : displayedTime;
  const awaitingPausedTargetFrame =
    hasPresentedOwnerMismatch ||
    !deps.isPlaying &&
    !isDragging &&
    !hasStablePausedHtmlFrame &&
    (!isSettling &&
      (!hasConfirmedPresentedFrame || Math.abs(lastPresentedTime - targetTime) > 0.05));
  const cacheSearchDistanceFrames = isDragging ? 10 : 6;
  const lastSameClipFrame = filterPausedHtmlTargetFrame(
    getDragHoldFrame(layer, video, deps),
    targetTime,
    shouldGuardPausedTargetFrames
  );
  const dragHoldFrame = isDragging
    ? isFrameNearTarget(
      lastSameClipFrame,
      targetTime,
      MAX_DRAG_FALLBACK_DRIFT_SECONDS
    )
      ? lastSameClipFrame
      : null
      : (isSettling || awaitingPausedTargetFrame) && isFrameNearTarget(lastSameClipFrame, targetTime)
      ? lastSameClipFrame
    : null;
  const emergencyHoldFrame = dragHoldFrame;
  const sameClipHoldFrame =
    (isDragging || isSettling || awaitingPausedTargetFrame || video.seeking)
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
  const safeFallback =
    filterPausedHtmlTargetFrame(
      getSafeLastFrameFallback(layer, video, deps, targetTime),
      targetTime,
      shouldGuardPausedTargetFrames
    ) ?? dragHoldFrame;
  const shouldPreferStableHold = controller.shouldPreferHtmlHold(layerReuseKey, {
    hasHoldFrame: !!safeFallback || !!emergencyHoldFrame || !!sameClipHoldFrame,
    isDragging,
    isSettling,
    awaitingPausedTargetFrame,
    hasFreshPresentedFrame,
  });
  const allowDragLiveVideoImport =
    !shouldPreferStableHold &&
    !video.seeking &&
    (presentedDriftSeconds ?? currentTimeDriftSeconds) <=
      MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS;
  let allowLiveVideoImport =
    !shouldPreferStableHold &&
    !hasPresentedOwnerMismatch &&
    (isPausedSettle
      ? hasFreshPresentedFrame
      : !awaitingPausedTargetFrame &&
        (((!isDragging && !isSettling) || hasFreshPresentedFrame || (isDragging ? allowDragLiveVideoImport : !safeFallback))));
  if (options.playbackFallback && !isPlaybackHtmlLiveFrameUsable(layer, video)) {
    allowLiveVideoImport = false;
  }
  const allowConfirmedFrameCaching = !hasPresentedOwnerMismatch && (isPausedSettle
    ? hasFreshPresentedFrame
    : !awaitingPausedTargetFrame &&
      (((!isDragging && !isSettling) || hasFreshPresentedFrame)));
  const captureOwnerId = allowConfirmedFrameCaching ? layer.sourceClipId : undefined;

  if ((video.seeking || awaitingPausedTargetFrame) && !deps.isExporting) {
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
      controller.traceScrubPath(layer, 'scrub-cache', video, targetTime, lastPresentedTime);
      controller.setDecoder('HTMLVideo(scrub-cache)');
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: pausedTargetCachedFrame.view,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        displayedMediaTime: pausedTargetCachedFrame.mediaTime,
        targetMediaTime: targetTime,
        previewPath: 'scrub-cache',
      };
    }
    if (safeFallback) {
      controller.armHtmlHold(layerReuseKey);
      controller.traceScrubPath(layer, 'seeking-cache', video, targetTime, lastPresentedTime);
      controller.setDecoder('HTMLVideo(seeking-cache)');
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: safeFallback.view,
        sourceWidth: safeFallback.width,
        sourceHeight: safeFallback.height,
        displayedMediaTime: safeFallback.mediaTime,
        targetMediaTime: targetTime,
        previewPath: 'seeking-cache',
      };
    }
    if (emergencyHoldFrame) {
      controller.armHtmlHold(layerReuseKey);
      controller.traceScrubPath(layer, 'emergency-hold', video, targetTime, lastPresentedTime);
      controller.setDecoder('HTMLVideo(cached)');
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
      controller.traceScrubPath(layer, 'same-clip-hold', video, targetTime, lastPresentedTime);
      controller.setDecoder('HTMLVideo(cached)');
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
  }

  if (!controller.isVideoGpuReady(video) && !deps.isExporting) {
    if (!video.paused && !video.seeking) {
      controller.markVideoGpuReady(video);
    } else if (!deps.isPlaying && !hasStablePausedHtmlFrame) {
      if (safeFallback) {
        controller.armHtmlHold(layerReuseKey);
        controller.traceScrubPath(layer, 'gpu-cached', video, targetTime, lastPresentedTime);
        deps.setLastVideoTime(videoKey, currentTime);
        controller.setDecoder('HTMLVideo(cached)');
        return {
          layer,
          isVideo: false,
          externalTexture: null,
          textureView: safeFallback.view,
          sourceWidth: safeFallback.width,
          sourceHeight: safeFallback.height,
          displayedMediaTime: safeFallback.mediaTime,
          targetMediaTime: targetTime,
          previewPath: 'gpu-cached',
        };
      }
      controller.traceScrubPath(layer, 'gpu-not-ready-drop', video, targetTime, lastPresentedTime);
      return null;
    }
  }

  if (allowLiveVideoImport) {
    const copiedFrame = getCopiedHtmlVideoPreviewFrame(
      video,
      deps.scrubbingCache,
      targetTime,
      layer.sourceClipId,
      captureOwnerId,
      hasStablePausedHtmlFrame
    );
    if (copiedFrame) {
      controller.clearHtmlHold(layerReuseKey);
      controller.traceScrubPath(layer, 'copied-preview', video, targetTime, lastPresentedTime);
      deps.setLastVideoTime(videoKey, currentTime);
      controller.setDecoder('HTMLVideo');
      controller.markHasVideo();
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: copiedFrame.view,
        sourceWidth: copiedFrame.width,
        sourceHeight: copiedFrame.height,
        displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
        targetMediaTime: targetTime,
        previewPath: 'copied-preview',
      };
    }
  }

  const extTex = allowLiveVideoImport
    ? deps.textureManager.importVideoTexture(video)
    : null;
  if (extTex) {
    controller.clearHtmlHold(layerReuseKey);
    deps.setLastVideoTime(videoKey, currentTime);
    if (deps.isPlaying) {
      const now = performance.now();
      const lastCapture = deps.scrubbingCache?.getLastCaptureTime(video) || 0;
      if (now - lastCapture > PLAYBACK_CACHE_CAPTURE_INTERVAL_MS) {
        deps.scrubbingCache?.captureVideoFrame(video, layer.sourceClipId);
        deps.scrubbingCache?.setLastCaptureTime(video, now);
      }
    } else if (allowLiveVideoImport) {
      const now = performance.now();
      const lastCapture = deps.scrubbingCache?.getLastCaptureTime(video) || 0;
      if (allowConfirmedFrameCaching && now - lastCapture > 50) {
        deps.scrubbingCache?.captureVideoFrame(video, captureOwnerId);
        deps.scrubbingCache?.setLastCaptureTime(video, now);
      }

      if (allowConfirmedFrameCaching) {
        deps.scrubbingCache?.cacheFrameAtTime(video, targetTime);
      } else {
        if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
          deps.scrubbingCache?.captureVideoFrameIfCloser(
            video,
            targetTime,
            displayedTime,
            layer.sourceClipId
          );
        }
        if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
          deps.scrubbingCache?.cacheFrameAtTime(video, displayedTime);
        }
      }
    }

    controller.traceScrubPath(layer, 'live-import', video, targetTime, lastPresentedTime);
    controller.setDecoder('HTMLVideo');
    controller.markHasVideo();
    return {
      layer,
      isVideo: true,
      externalTexture: extTex,
      textureView: null,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      displayedMediaTime: reportedDisplayedTime,
      targetMediaTime: targetTime,
      previewPath: 'live-import',
    };
  }

  if (isDragging && !allowLiveVideoImport) {
    const cachedFrame =
      deps.scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
      deps.scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames);
    if (cachedFrame) {
      controller.armHtmlHold(layerReuseKey);
      controller.traceScrubPath(layer, 'scrub-cache', video, targetTime, lastPresentedTime);
      controller.setDecoder('HTMLVideo(scrub-cache)');
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: cachedFrame.view,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        displayedMediaTime: cachedFrame.mediaTime,
        targetMediaTime: targetTime,
        previewPath: 'scrub-cache',
      };
    }
  }

  if (safeFallback) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'final-cache', video, targetTime, lastPresentedTime);
    controller.setDecoder('HTMLVideo(cached)');
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: safeFallback.view,
      sourceWidth: safeFallback.width,
      sourceHeight: safeFallback.height,
      displayedMediaTime: safeFallback.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'final-cache',
    };
  }
  if (emergencyHoldFrame) {
    controller.armHtmlHold(layerReuseKey);
    controller.traceScrubPath(layer, 'emergency-hold', video, targetTime, lastPresentedTime);
    controller.setDecoder('HTMLVideo(cached)');
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
    controller.traceScrubPath(layer, 'same-clip-hold', video, targetTime, lastPresentedTime);
    controller.setDecoder('HTMLVideo(cached)');
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
      controller.traceScrubPath(layer, 'playback-stall-hold', video, targetTime, lastPresentedTime);
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
  controller.traceScrubPath(layer, 'final-drop', video, targetTime, lastPresentedTime);
  return null;
}
