import type { Layer, LayerRenderData } from '../../core/types';
import { flags } from '../../featureFlags';
import type { TextureManager } from '../../texture/TextureManager';
import type { ScrubbingCache } from '../../texture/ScrubbingCache';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { useTimelineStore } from '../../../stores/timeline';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';

const ENABLE_VISUAL_HTML_VIDEO_FALLBACK = false;
const MAX_DRAG_FALLBACK_DRIFT_SECONDS = 1.2;
const MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS = 0.9;
const HTML_HOLD_RECOVERY_MS = 120;
const PLAYBACK_CACHE_CAPTURE_INTERVAL_MS = 2000;
const IMPORT_FAILURE_WARN_INTERVAL_MS = 2000;
const importFailureWarnAt = new Map<string, number>();

type VideoProvider = NonNullable<NonNullable<Layer['source']>['webCodecsPlayer']>;

interface TryCollectHtmlVideoPreviewParams {
  layer: Layer;
  runtimeProvider: VideoProvider | null;
  clipProvider: VideoProvider | null;
  textureManager: TextureManager;
  scrubbingCache: ScrubbingCache | null;
  htmlHoldUntil: Map<string, number>;
  debug: (message: string, context: Record<string, string>) => void;
  warn: (message: string, context: Record<string, string>) => void;
}

export function getNestedVideoOwnerId(layer: Pick<Layer, 'sourceClipId'>): string | undefined {
  const clipId = layer.sourceClipId;
  return clipId?.startsWith('transition-comp:')
    ? clipId.replace(/:(?:seg|part):\d+/g, '')
    : clipId;
}

export function getCompatibleNestedVideoOwnerId(
  layer: Pick<Layer, 'sourceClipId'>,
  lastPresentedOwner: string | undefined,
  lastPresentedTime: number | undefined,
  targetTime: number,
  currentVideoTime?: number,
): string | undefined {
  return lastPresentedOwner &&
    (
      typeof lastPresentedTime === 'number' &&
      Number.isFinite(lastPresentedTime) &&
      Math.abs(lastPresentedTime - targetTime) <= 0.2 ||
      typeof currentVideoTime === 'number' &&
      Number.isFinite(currentVideoTime) &&
      Math.abs(currentVideoTime - targetTime) <= 0.2
    )
    ? lastPresentedOwner
    : getNestedVideoOwnerId(layer);
}

export function getNestedVideoReuseKey(layer: Pick<Layer, 'id' | 'sourceClipId'>): string {
  const ownerId = getNestedVideoOwnerId(layer);
  if (ownerId?.startsWith('transition-comp:')) return ownerId;
  return ownerId ? `${layer.id}:${ownerId}` : layer.id;
}

function getTargetVideoTime(layer: Layer, video: HTMLVideoElement): number {
  return layer.source?.mediaTime ?? video.currentTime;
}

function isFrameNearTarget(
  frame: { mediaTime?: number } | null | undefined,
  targetTime: number,
  maxDeltaSeconds: number = 0.35
): boolean {
  return (
    typeof frame?.mediaTime === 'number' &&
    Number.isFinite(frame.mediaTime) &&
    Math.abs(frame.mediaTime - targetTime) <= maxDeltaSeconds
  );
}

function getDragHoldFrame(
  ownerId: string | undefined,
  video: HTMLVideoElement,
  scrubbingCache: ScrubbingCache | null
) {
  if (!ownerId) {
    return null;
  }
  return scrubbingCache?.getLastFrame(video, ownerId) ?? null;
}

function getSafeLastFrameFallback(
  ownerId: string | undefined,
  video: HTMLVideoElement,
  targetTime: number,
  scrubbingCache: ScrubbingCache | null
) {
  if (!scrubbingCache) {
    return null;
  }
  const isDragging = useTimelineStore.getState().isDraggingPlayhead;
  const tolerance = video.seeking || isDragging ? 0.35 : 0.2;
  return scrubbingCache.getLastFrameNearTime(video, targetTime, tolerance, ownerId);
}

function armHtmlHold(htmlHoldUntil: Map<string, number>, layerId: string): void {
  htmlHoldUntil.set(
    layerId,
    performance.now() + HTML_HOLD_RECOVERY_MS
  );
}

function clearHtmlHold(htmlHoldUntil: Map<string, number>, layerId: string): void {
  htmlHoldUntil.delete(layerId);
}

function shouldWarnImportFailure(layerId: string): boolean {
  const now = performance.now();
  const lastWarnAt = importFailureWarnAt.get(layerId) ?? 0;
  if (now - lastWarnAt < IMPORT_FAILURE_WARN_INTERVAL_MS) {
    return false;
  }
  importFailureWarnAt.set(layerId, now);
  return true;
}

function shouldPreferHtmlHold(
  htmlHoldUntil: Map<string, number>,
  layerId: string,
  options: {
    hasHoldFrame: boolean;
    isDragging: boolean;
    isSettling: boolean;
    awaitingPausedTargetFrame: boolean;
    hasFreshPresentedFrame: boolean;
  }
): boolean {
  if (!options.hasHoldFrame) {
    clearHtmlHold(htmlHoldUntil, layerId);
    return false;
  }

  if (
    !options.isDragging &&
    !options.isSettling &&
    !options.awaitingPausedTargetFrame &&
    options.hasFreshPresentedFrame
  ) {
    clearHtmlHold(htmlHoldUntil, layerId);
    return false;
  }

  return (htmlHoldUntil.get(layerId) ?? 0) > performance.now();
}

export function tryCollectHtmlVideoPreview(
  params: TryCollectHtmlVideoPreviewParams
): LayerRenderData | null | undefined {
  const {
    layer,
    runtimeProvider,
    clipProvider,
    textureManager,
    scrubbingCache,
    htmlHoldUntil,
    debug,
    warn,
  } = params;

  const htmlPreviewDebugDisabled =
    flags.useFullWebCodecsPlayback &&
    flags.disableHtmlPreviewFallback;
  const hasFullWebCodecsPreview =
    flags.useFullWebCodecsPlayback &&
    (!!clipProvider || !!runtimeProvider?.isFullMode());
  const allowHtmlScrubPreview =
    !htmlPreviewDebugDisabled &&
    !hasFullWebCodecsPreview &&
    (useTimelineStore.getState().isDraggingPlayhead || scrubSettleState.isPending(layer.sourceClipId)) &&
    !!layer.source?.videoElement;
  const allowHtmlVideoPreview =
    !!layer.source?.videoElement &&
    !htmlPreviewDebugDisabled &&
    (!hasFullWebCodecsPreview ||
      ENABLE_VISUAL_HTML_VIDEO_FALLBACK ||
      allowHtmlScrubPreview);

  if (!allowHtmlVideoPreview) {
    return undefined;
  }

  const video = layer.source?.videoElement;
  if (!video) {
    return undefined;
  }
  const layerReuseKey = getNestedVideoReuseKey(layer);
  const targetTime = getTargetVideoTime(layer, video);
  const timelineState = useTimelineStore.getState();
  const isPlaying = timelineState.isPlaying;
  const isDragging = timelineState.isDraggingPlayhead;
  scrubbingCache?.preloadAroundTime?.(video, targetTime, {
    isDragging,
    isPlaying,
  });
  const isSettling = scrubSettleState.isPending(layer.sourceClipId);
  const isPausedSettle = !isPlaying && !isDragging && isSettling;
  const lastPresentedTime = scrubbingCache?.getLastPresentedTime(video);
  const lastPresentedOwner = scrubbingCache?.getLastPresentedOwner(video);
  const ownerId = getCompatibleNestedVideoOwnerId(
    layer,
    lastPresentedOwner,
    lastPresentedTime,
    targetTime,
    video.readyState >= 2 && !video.seeking ? video.currentTime : undefined,
  );
  const hasPresentedOwnerMismatch =
    !!ownerId &&
    !!lastPresentedOwner &&
    lastPresentedOwner !== ownerId;
  const hasConfirmedPresentedFrame =
    !hasPresentedOwnerMismatch &&
    typeof lastPresentedTime === 'number' &&
    Number.isFinite(lastPresentedTime);
  const displayedTime = hasConfirmedPresentedFrame ? lastPresentedTime : undefined;
  const reportedDisplayedTime =
    isPlaying &&
    !video.paused &&
    !video.seeking &&
    Number.isFinite(video.currentTime)
      ? video.currentTime
      : displayedTime;
  const hasFreshPresentedFrame =
    hasConfirmedPresentedFrame &&
    Math.abs(lastPresentedTime - targetTime) <= 0.12;
  const presentedDriftSeconds = hasConfirmedPresentedFrame
    ? Math.abs(lastPresentedTime - targetTime)
    : undefined;
  const awaitingPausedTargetFrame =
    hasPresentedOwnerMismatch ||
    !isPlaying &&
    !isDragging &&
    (!isSettling &&
      (!hasConfirmedPresentedFrame || Math.abs(lastPresentedTime - targetTime) > 0.05));
  const cacheSearchDistanceFrames = isDragging ? 12 : 6;
  const lastSameClipFrame = getDragHoldFrame(ownerId, video, scrubbingCache);
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
    !isPlaying &&
    (isDragging || isSettling || awaitingPausedTargetFrame || video.seeking)
      ? lastSameClipFrame
      : null;
  const safeFallback = getSafeLastFrameFallback(ownerId, video, targetTime, scrubbingCache) ?? dragHoldFrame;
  const shouldPreferStableHold = shouldPreferHtmlHold(htmlHoldUntil, layerReuseKey, {
    hasHoldFrame: !!safeFallback || !!emergencyHoldFrame || !!sameClipHoldFrame,
    isDragging,
    isSettling,
    awaitingPausedTargetFrame,
    hasFreshPresentedFrame,
  });
  const allowDragLiveVideoImport =
    !shouldPreferStableHold &&
    !video.seeking &&
    (
      !hasConfirmedPresentedFrame ||
      (presentedDriftSeconds ?? 0) <= MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS
    );
  const allowLiveVideoImport =
    !shouldPreferStableHold &&
    !hasPresentedOwnerMismatch &&
    (isPausedSettle
      ? hasFreshPresentedFrame
      : !awaitingPausedTargetFrame &&
        (((!isDragging && !isSettling) || hasFreshPresentedFrame || (isDragging ? allowDragLiveVideoImport : !safeFallback))));
  const allowConfirmedFrameCaching = !hasPresentedOwnerMismatch && (isPausedSettle
    ? hasFreshPresentedFrame
    : !awaitingPausedTargetFrame &&
      (((!isDragging && !isSettling) || hasFreshPresentedFrame)));
  const captureOwnerId = allowConfirmedFrameCaching ? ownerId : undefined;

  if ((video.seeking || awaitingPausedTargetFrame) && scrubbingCache) {
    const cachedView =
      scrubbingCache.getCachedFrame(video.src, targetTime) ??
      scrubbingCache.getNearestCachedFrame(video.src, targetTime, cacheSearchDistanceFrames);
    if (cachedView) {
      armHtmlHold(htmlHoldUntil, layerReuseKey);
      return {
        layer, isVideo: false, externalTexture: null, textureView: cachedView,
        sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
      };
    }
    if (!allowLiveVideoImport) {
      if (safeFallback) {
        armHtmlHold(htmlHoldUntil, layerReuseKey);
        return {
          layer, isVideo: false, externalTexture: null, textureView: safeFallback.view,
          sourceWidth: safeFallback.width, sourceHeight: safeFallback.height,
        };
      }
      if (emergencyHoldFrame) {
        armHtmlHold(htmlHoldUntil, layerReuseKey);
        return {
          layer, isVideo: false, externalTexture: null, textureView: emergencyHoldFrame.view,
          sourceWidth: emergencyHoldFrame.width, sourceHeight: emergencyHoldFrame.height,
        };
      }
      if (sameClipHoldFrame) {
        armHtmlHold(htmlHoldUntil, layerReuseKey);
        return {
          layer, isVideo: false, externalTexture: null, textureView: sameClipHoldFrame.view,
          sourceWidth: sameClipHoldFrame.width, sourceHeight: sameClipHoldFrame.height,
          displayedMediaTime: sameClipHoldFrame.mediaTime,
          targetMediaTime: targetTime,
          previewPath: 'same-clip-hold',
        };
      }
      return null;
    }
  }

  if (video.readyState >= 2) {
    if (allowLiveVideoImport && !isPlaying) {
      const copiedFrame = getCopiedHtmlVideoPreviewFrame(
        video,
        scrubbingCache,
        targetTime,
        ownerId,
        captureOwnerId
      );
      if (copiedFrame) {
        clearHtmlHold(htmlHoldUntil, layerReuseKey);
        return {
          layer, isVideo: false, externalTexture: null, textureView: copiedFrame.view,
          sourceWidth: copiedFrame.width, sourceHeight: copiedFrame.height,
          displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
          targetMediaTime: targetTime,
          previewPath: 'copied-preview',
        };
      }
    }

    const extTex = allowLiveVideoImport
      ? textureManager.importVideoTexture(video)
      : null;
    if (extTex) {
      clearHtmlHold(htmlHoldUntil, layerReuseKey);
      if (scrubbingCache) {
        const now = performance.now();
        const lastCapture = scrubbingCache.getLastCaptureTime(video);
        if (isPlaying) {
          if (now - lastCapture > PLAYBACK_CACHE_CAPTURE_INTERVAL_MS) {
            scrubbingCache.captureVideoFrame(video, ownerId);
            scrubbingCache.setLastCaptureTime(video, now);
          }
        } else if (allowConfirmedFrameCaching) {
          if (now - lastCapture > 50) {
            scrubbingCache.captureVideoFrame(video, captureOwnerId);
            scrubbingCache.setLastCaptureTime(video, now);
          }
          scrubbingCache.cacheFrameAtTime(video, targetTime);
        } else {
          if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
            scrubbingCache.captureVideoFrameIfCloser(
              video,
              targetTime,
              displayedTime,
              ownerId
            );
          }
          if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
            scrubbingCache.cacheFrameAtTime(video, displayedTime);
          }
        }
      }
      return {
        layer, isVideo: true, externalTexture: extTex, textureView: null,
        sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
        displayedMediaTime: reportedDisplayedTime,
        targetMediaTime: targetTime,
        previewPath: 'live-import',
      };
    } else {
      if (allowLiveVideoImport && isPlaying) {
        const copiedFrame = getCopiedHtmlVideoPreviewFrame(
          video,
          scrubbingCache,
          targetTime,
          ownerId,
          captureOwnerId
        );
        if (copiedFrame) {
          clearHtmlHold(htmlHoldUntil, layerReuseKey);
          return {
            layer, isVideo: false, externalTexture: null, textureView: copiedFrame.view,
            sourceWidth: copiedFrame.width, sourceHeight: copiedFrame.height,
            displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
            targetMediaTime: targetTime,
            previewPath: 'copied-preview',
          };
        }
      }
      const context = { layerId: layer.id };
      if (shouldWarnImportFailure(layerReuseKey)) {
        warn('Failed to import video texture', context);
      } else {
        debug('Failed to import video texture', context);
      }
    }
  }

  const notReadyCachedFrame =
    scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
    scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames);
  if (notReadyCachedFrame) {
    armHtmlHold(htmlHoldUntil, layerReuseKey);
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: notReadyCachedFrame.view,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      displayedMediaTime: notReadyCachedFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'not-ready-scrub-cache',
    };
  }

  if (safeFallback) {
    armHtmlHold(htmlHoldUntil, layerReuseKey);
    debug('Using cached frame fallback for nested video', { layerId: layer.id });
    return {
      layer, isVideo: false, externalTexture: null, textureView: safeFallback.view,
      sourceWidth: safeFallback.width, sourceHeight: safeFallback.height,
    };
  }
  if (emergencyHoldFrame) {
    armHtmlHold(htmlHoldUntil, layerReuseKey);
    return {
      layer, isVideo: false, externalTexture: null, textureView: emergencyHoldFrame.view,
      sourceWidth: emergencyHoldFrame.width, sourceHeight: emergencyHoldFrame.height,
      displayedMediaTime: emergencyHoldFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'emergency-hold',
    };
  }
  if (sameClipHoldFrame) {
    armHtmlHold(htmlHoldUntil, layerReuseKey);
    return {
      layer, isVideo: false, externalTexture: null, textureView: sameClipHoldFrame.view,
      sourceWidth: sameClipHoldFrame.width, sourceHeight: sameClipHoldFrame.height,
      displayedMediaTime: sameClipHoldFrame.mediaTime,
      targetMediaTime: targetTime,
      previewPath: 'same-clip-hold',
    };
  }

  return undefined;
}
