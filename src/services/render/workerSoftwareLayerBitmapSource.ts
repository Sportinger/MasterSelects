// Where a worker software preview layer's pixels come from: a nested composition, a text
// canvas, a runtime (WebCodecs) frame or an HTML video snapshot, with the reason when none is
// usable. Split from workerSoftwarePreviewFrame.ts, which assembles the frame from these sources.
import type { Layer } from '../../types';
import { mediaRuntimeRegistry } from '../mediaRuntime/registry';
import { getFullFrameCanvas } from '../text/textCanvasFrameRegistry';
import type { FrameHandle, RuntimeFrame } from '../mediaRuntime/types';
import { renderNestedCompositionBitmapSource } from './workerSoftwareNestedComposition';
import {
  expectedWorkerSoftwareHtmlVideoSnapshotSize,
  getCachedWorkerSoftwareHtmlVideoSnapshotSource,
  workerSoftwareBitmapCacheKeyForSnapshot,
  workerSoftwareHtmlVideoFrameKey,
} from './workerSoftwareHtmlVideoSnapshotCache';
import type {
  WorkerLayerBitmapSkip,
  WorkerLayerBitmapSource,
  WorkerSoftwarePreviewFrameBuildOptions,
  WorkerSoftwarePreviewSkipReason,
} from './workerSoftwarePreviewFrame';

type NestedFrameBuilder = Parameters<typeof renderNestedCompositionBitmapSource>[0]['buildNestedFrame'];

function isRenderableVideoElement(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.videoWidth > 0
    && video.videoHeight > 0;
}

function quantizedMediaTimeKey(mediaTime: number | undefined): string {
  return typeof mediaTime === 'number' && Number.isFinite(mediaTime)
    ? String(Math.round(mediaTime * 30))
    : 'unknown';
}

function htmlVideoSnapshotContentKey(
  video: HTMLVideoElement,
  ownerId: string | undefined,
  width: number,
  height: number,
  frameKey = workerSoftwareHtmlVideoFrameKey(video),
): string {
  return `html-video:${ownerId ?? 'unknown'}:${frameKey}:${width}x${height}`;
}

function htmlVideoWorkerBitmapCacheKey(
  video: HTMLVideoElement,
  ownerId: string | undefined,
  options: WorkerSoftwarePreviewFrameBuildOptions,
  mediaTime?: number,
): string | undefined {
  if (!options.workerBitmapCacheKeys || !ownerId) return undefined;
  const snapshotSize = expectedWorkerSoftwareHtmlVideoSnapshotSize({
    video,
    maxSize: options.maxBitmapSnapshotSize,
  });
  return workerSoftwareBitmapCacheKeyForSnapshot({
    ownerId,
    mediaTime,
    frameKey: workerSoftwareHtmlVideoFrameKey(video, mediaTime),
    width: snapshotSize.width,
    height: snapshotSize.height,
  });
}

function videoSnapshotSkipReason(
  video: HTMLVideoElement,
  targetTime: number | undefined,
  maxDriftOverrideSeconds?: number,
): WorkerSoftwarePreviewSkipReason | null {
  if (!isRenderableVideoElement(video)) return 'video-not-ready';
  if (video.seeking) return 'video-seeking';
  if (
    typeof targetTime === 'number' &&
    Number.isFinite(targetTime) &&
    Number.isFinite(video.currentTime)
  ) {
    const maxDrift = typeof maxDriftOverrideSeconds === 'number' && Number.isFinite(maxDriftOverrideSeconds)
      ? maxDriftOverrideSeconds
      : video.paused ? 0.18 : 0.5;
    if (Math.abs(video.currentTime - targetTime) > maxDrift) {
      return 'video-time-drift';
    }
  }
  return null;
}

function runtimeFrameDimensions(frame: RuntimeFrame): {
  readonly width: number;
  readonly height: number;
} | null {
  if (!frame) return null;
  const videoFrame = frame as VideoFrame;
  const videoFrameWidth = videoFrame.displayWidth || videoFrame.codedWidth;
  const videoFrameHeight = videoFrame.displayHeight || videoFrame.codedHeight;
  if (videoFrameWidth > 0 && videoFrameHeight > 0) {
    return { width: videoFrameWidth, height: videoFrameHeight };
  }
  const bitmap = frame as ImageBitmap;
  if (bitmap.width > 0 && bitmap.height > 0) {
    return { width: bitmap.width, height: bitmap.height };
  }
  return null;
}

function runtimeFrameTimestampSeconds(frame: RuntimeFrame, fallback?: number | null): number | null {
  const timestamp = (frame as { timestamp?: unknown } | null)?.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp / 1_000_000;
  }
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

function runtimeFrameDriftMs(
  frame: RuntimeFrame,
  targetTime: number | undefined,
  displayedTime?: number | null,
): number | undefined {
  if (typeof targetTime !== 'number' || !Number.isFinite(targetTime)) return undefined;
  const frameTime = runtimeFrameTimestampSeconds(frame, displayedTime);
  return frameTime === null ? undefined : Math.abs(frameTime - targetTime) * 1000;
}

function runtimeFrameSkipReason(
  frame: RuntimeFrame,
  targetTime: number | undefined,
  isPlaying: boolean,
  maxDriftOverrideSeconds?: number,
  displayedTime?: number | null,
): WorkerSoftwarePreviewSkipReason | null {
  if (!runtimeFrameDimensions(frame)) return 'empty-video-frame';
  if (typeof targetTime !== 'number' || !Number.isFinite(targetTime)) return null;
  const frameTime = runtimeFrameTimestampSeconds(frame, displayedTime);
  if (frameTime === null) return null;
  const maxDrift = typeof maxDriftOverrideSeconds === 'number' && Number.isFinite(maxDriftOverrideSeconds)
    ? maxDriftOverrideSeconds
    : isPlaying ? 0.5 : 0.18;
  return Math.abs(frameTime - targetTime) > maxDrift ? 'video-time-drift' : null;
}

function runtimeFrameSource(
  frame: RuntimeFrame,
  targetTime: number | undefined,
  isPlaying: boolean,
  release?: () => void,
  maxDriftSeconds?: number,
  displayedTime?: number | null,
): WorkerLayerBitmapSource | WorkerLayerBitmapSkip | null {
  const frameTime = runtimeFrameTimestampSeconds(frame, displayedTime);
  const driftMs = runtimeFrameDriftMs(frame, targetTime, frameTime);
  const skipReason = runtimeFrameSkipReason(frame, targetTime, isPlaying, maxDriftSeconds, frameTime);
  if (skipReason) {
    release?.();
    return {
      reason: skipReason,
      ...(driftMs !== undefined ? { driftMs } : {}),
    };
  }
  const dimensions = runtimeFrameDimensions(frame);
  if (!frame || !dimensions) {
    release?.();
    return null;
  }
  return {
    source: frame as ImageBitmapSource,
    width: dimensions.width,
    height: dimensions.height,
    ...(release ? { release } : {}),
    decoderKind: 'webcodecs',
    contentKey: `runtime-frame:${quantizedMediaTimeKey(frameTime ?? targetTime)}:${dimensions.width}x${dimensions.height}`,
    ...(driftMs !== undefined ? { driftMs } : {}),
  };
}

function runtimeProviderMaxDriftSeconds(source: NonNullable<Layer['source']>): number | undefined {
  const provider = source.webCodecsPlayer;
  if (!provider?.isPlaying) return undefined;
  if (source.forceRuntimeFramePreview) return 1.25;
  const frameRate = provider.getFrameRate?.() ?? 30;
  return Math.max(0.08, Math.min(0.16, 4 / Math.max(frameRate, 1)));
}

function runtimeRegistryFrameSource(source: NonNullable<Layer['source']>): ReturnType<typeof runtimeFrameSource> {
  if (!source.runtimeSourceId || !source.runtimeSessionKey || typeof source.mediaTime !== 'number') {
    return null;
  }
  const runtime = mediaRuntimeRegistry.getRuntime(source.runtimeSourceId);
  const handle: FrameHandle | null = runtime?.getFrameSync({
    sourceId: source.runtimeSourceId,
    sessionKey: source.runtimeSessionKey,
    sourceTime: source.mediaTime,
    playbackMode: 'interactive',
    allowCache: true,
  }) ?? null;
  if (!handle?.frame) {
    handle?.release();
    return null;
  }
  return runtimeFrameSource(handle.frame, source.mediaTime, false, () => handle.release(), undefined, handle.timestamp / 1_000_000);
}

function runtimeProviderFrameSource(source: NonNullable<Layer['source']>): ReturnType<typeof runtimeFrameSource> {
  const provider = source.webCodecsPlayer;
  if (!provider) return null;
  const frame = provider.getCurrentFrame?.() ?? null;
  if (!frame) return null;
  const displayedTime = provider.getDebugInfo?.()?.currentFrameTimestampSeconds;
  return runtimeFrameSource(
    frame,
    source.mediaTime,
    provider.isPlaying,
    undefined,
    runtimeProviderMaxDriftSeconds(source),
    displayedTime,
  );
}

export function layerBitmapSource(
  layer: Layer,
  options: WorkerSoftwarePreviewFrameBuildOptions,
  depth: number,
  buildNestedFrame: NestedFrameBuilder,
): WorkerLayerBitmapSource
  | WorkerLayerBitmapSkip
  | Promise<WorkerLayerBitmapSource | WorkerLayerBitmapSkip> {
  const source = layer.source;
  if (!source) return { reason: 'missing-source' };

  if (source.nestedComposition) {
    return renderNestedCompositionBitmapSource({
      layer,
      nestedComposition: source.nestedComposition,
      options,
      depth,
      buildNestedFrame,
    });
  }

  // Workers receive raw pixels: cropped text is expanded to its composition-sized source.
  const textCanvas = source.textCanvas ? getFullFrameCanvas(source.textCanvas) : undefined;
  if (textCanvas && textCanvas.width > 0 && textCanvas.height > 0) {
    return {
      source: textCanvas,
      width: textCanvas.width,
      height: textCanvas.height,
      contentKey: `text-canvas:${layer.id}:${textCanvas.width}x${textCanvas.height}`,
    };
  }
  if (source.textCanvas) return { reason: 'empty-text-canvas' };

  if (source.imageElement && source.imageElement.naturalWidth > 0 && source.imageElement.naturalHeight > 0) {
    return {
      source: source.imageElement,
      width: source.imageElement.naturalWidth,
      height: source.imageElement.naturalHeight,
      contentKey: `image:${layer.sourceClipId ?? layer.id}:${source.imageElement.naturalWidth}x${source.imageElement.naturalHeight}`,
    };
  }
  if (source.imageElement) return { reason: 'empty-image' };

  let videoFrameSkipReason: WorkerSoftwarePreviewSkipReason | null = null;
  if (source.videoFrame && source.videoFrame.codedWidth > 0 && source.videoFrame.codedHeight > 0) {
    return {
          source: source.videoFrame as unknown as ImageBitmapSource,
          width: source.videoFrame.codedWidth,
          height: source.videoFrame.codedHeight,
          decoderKind: 'webcodecs',
          contentKey: `video-frame:${layer.sourceClipId ?? layer.id}:${quantizedMediaTimeKey(runtimeFrameTimestampSeconds(source.videoFrame as unknown as RuntimeFrame) ?? source.mediaTime)}:${source.videoFrame.codedWidth}x${source.videoFrame.codedHeight}`,
        };
      }
  if (source.videoFrame) {
    videoFrameSkipReason = 'empty-video-frame';
  }

  let runtimeSkip: WorkerLayerBitmapSkip | null = null;
  const runtimeResult = runtimeRegistryFrameSource(source) ?? runtimeProviderFrameSource(source);
  if (runtimeResult) {
    if ('source' in runtimeResult) return runtimeResult;
    runtimeSkip = runtimeResult;
  }
  if (source.forceRuntimeFramePreview) {
    if (runtimeSkip) return runtimeSkip;
    if (videoFrameSkipReason) return { reason: videoFrameSkipReason };
    return { reason: 'runtime-frame-missing' };
  }

  if (source.videoElement) {
    const liveWorkerBitmapCacheKey = htmlVideoWorkerBitmapCacheKey(
      source.videoElement,
      layer.sourceClipId,
      options,
      source.mediaTime,
    );
    const liveFrameKey = workerSoftwareHtmlVideoFrameKey(source.videoElement, source.mediaTime);
    const liveWorkerBitmapCacheSize = liveWorkerBitmapCacheKey
      ? expectedWorkerSoftwareHtmlVideoSnapshotSize({
          video: source.videoElement,
          maxSize: options.maxBitmapSnapshotSize,
        })
      : null;
    if (
      options.allowCachedVideoSnapshots &&
      options.preferCachedVideoSnapshots !== false &&
      options.cachedVideoSnapshotMaxDriftSeconds !== undefined
    ) {
      const cachedSnapshot = getCachedWorkerSoftwareHtmlVideoSnapshotSource(
        source.videoElement,
        layer.sourceClipId,
        source.mediaTime,
        options.cachedVideoSnapshotMaxDriftSeconds,
      );
      if (cachedSnapshot) return { ...cachedSnapshot, decoderKind: 'html-video' };
    }
    const skipReason = videoSnapshotSkipReason(
      source.videoElement,
      source.mediaTime,
      options.videoSnapshotMaxDriftSeconds,
    );
    if (skipReason) {
      if (options.allowCachedVideoSnapshots) {
        const cachedSnapshot = getCachedWorkerSoftwareHtmlVideoSnapshotSource(
          source.videoElement,
          layer.sourceClipId,
          source.mediaTime,
          options.cachedVideoSnapshotMaxDriftSeconds,
        );
        if (cachedSnapshot) return { ...cachedSnapshot, decoderKind: 'html-video' };
      }
      if (
        options.allowTransientVideoSnapshots &&
        skipReason !== 'video-not-ready' &&
        isRenderableVideoElement(source.videoElement)
      ) {
        return {
          source: source.videoElement,
          width: source.videoElement.videoWidth,
          height: source.videoElement.videoHeight,
          ...(options.cacheHtmlVideoSnapshots
            ? {
                cacheVideoElement: source.videoElement,
                cacheMediaTime: source.videoElement.currentTime,
                cacheOwnerId: layer.sourceClipId,
                workerBitmapCacheKey: liveWorkerBitmapCacheKey,
              }
            : {}),
          decoderKind: 'html-video',
          ...(liveWorkerBitmapCacheKey ? { workerBitmapCacheKey: liveWorkerBitmapCacheKey } : {}),
          workerBitmapFrameKey: liveFrameKey,
          ...(liveWorkerBitmapCacheSize
            ? {
                workerBitmapCacheWidth: liveWorkerBitmapCacheSize.width,
                workerBitmapCacheHeight: liveWorkerBitmapCacheSize.height,
              }
            : {}),
          contentKey: htmlVideoSnapshotContentKey(
            source.videoElement,
            layer.sourceClipId,
            source.videoElement.videoWidth,
            source.videoElement.videoHeight,
            liveFrameKey,
          ),
        };
      }
      return { reason: skipReason };
    }
    return {
      source: source.videoElement,
      width: source.videoElement.videoWidth,
      height: source.videoElement.videoHeight,
      ...(options.cacheHtmlVideoSnapshots
        ? {
            cacheVideoElement: source.videoElement,
            cacheMediaTime: source.videoElement.currentTime,
            cacheOwnerId: layer.sourceClipId,
            workerBitmapCacheKey: liveWorkerBitmapCacheKey,
          }
        : {}),
      decoderKind: 'html-video',
      ...(liveWorkerBitmapCacheKey ? { workerBitmapCacheKey: liveWorkerBitmapCacheKey } : {}),
      workerBitmapFrameKey: liveFrameKey,
      ...(liveWorkerBitmapCacheSize
        ? {
            workerBitmapCacheWidth: liveWorkerBitmapCacheSize.width,
            workerBitmapCacheHeight: liveWorkerBitmapCacheSize.height,
          }
        : {}),
      contentKey: htmlVideoSnapshotContentKey(
        source.videoElement,
        layer.sourceClipId,
        source.videoElement.videoWidth,
        source.videoElement.videoHeight,
        liveFrameKey,
      ),
    };
  }

  if (runtimeSkip) return runtimeSkip;
  if (videoFrameSkipReason) return { reason: videoFrameSkipReason };
  return { reason: 'unsupported-source' };
}
