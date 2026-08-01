import type { Layer } from '../../types';
import { mediaRuntimeRegistry } from '../mediaRuntime/registry';
import type { FrameHandle, RuntimeFrame } from '../mediaRuntime/types';
import type {
  WorkerRenderSoftwareFrame,
  WorkerRenderSoftwareLayerGeometry,
  WorkerRenderSoftwareLayer,
} from './workerRenderHostRuntimeCommands';
import { renderNestedCompositionBitmapSource } from './workerSoftwareNestedComposition';
import {
  canvasCompositeOperationForBlendMode,
  workerSoftwareEffectPlanForLayer,
} from './workerSoftwareEffectPlan';
import { createWorkerSoftwareBitmapSnapshot } from './workerSoftwareBitmapSnapshot';
import {
  expectedWorkerSoftwareHtmlVideoSnapshotSize,
  getCachedWorkerSoftwareHtmlVideoSnapshotSource,
  updateCachedWorkerSoftwareHtmlVideoSnapshot,
  workerSoftwareBitmapCacheKeyForSnapshot,
  workerSoftwareHtmlVideoFrameKey,
} from './workerSoftwareHtmlVideoSnapshotCache';
import { workerSoftwareTransitionFromLayer } from './workerSoftwareTransitions';

export interface WorkerSoftwarePreviewFrameBuildResult {
  readonly frame: WorkerRenderSoftwareFrame;
  readonly transfer: Transferable[];
  readonly diagnostics: WorkerSoftwarePreviewFrameDiagnostics;
}

export interface WorkerSoftwarePreviewFrameBuildOptions {
  readonly allowHtmlVideoSnapshots?: boolean;
  readonly allowCachedVideoSnapshots?: boolean;
  readonly cacheHtmlVideoSnapshots?: boolean;
  readonly preferCachedVideoSnapshots?: boolean;
  readonly allowTransientVideoSnapshots?: boolean;
  readonly cachedVideoSnapshotMaxDriftSeconds?: number;
  readonly videoSnapshotMaxDriftSeconds?: number;
  readonly workerBitmapCacheKeys?: ReadonlySet<string>;
  readonly heldVideoLayers?: ReadonlyMap<string, WorkerRenderSoftwareLayer>;
  readonly maxBitmapSnapshotSize?: { readonly width: number; readonly height: number };
  readonly bitmapSnapshotResizeQuality?: ResizeQuality;
}

export type WorkerSoftwarePreviewSkipReason =
  | 'createImageBitmap-failed'
  | 'empty-image'
  | 'empty-text-canvas'
  | 'empty-video-frame'
  | 'invisible'
  | 'missing-source'
  | 'non-rendering-source'
  | 'runtime-frame-missing'
  | 'scrub-hold'
  | 'unsupported-blend-mode'
  | 'unsupported-color-correction'
  | 'unsupported-effects'
  | 'unsupported-mask'
  | 'unsupported-nested-composition'
  | 'unsupported-source'
  | 'unsupported-transition'
  | 'video-not-ready'
  | 'video-seeking'
  | 'video-time-drift';

export interface WorkerSoftwarePreviewFrameDiagnostics {
  readonly sourceLayerCount: number;
  readonly presentableLayerCount: number;
  readonly skippedLayerCount: number;
  readonly bitmapLayerCount: number;
  readonly htmlVideoLayerCount: number;
  readonly webCodecsLayerCount: number;
  readonly forcedRuntimeFrameLayerCount: number;
  readonly solidLayerCount: number;
  readonly skippedByReason: Readonly<Record<WorkerSoftwarePreviewSkipReason, number>>;
  readonly maxVideoDriftMs: number;
}

export type WorkerLayerBitmapDecoderKind = 'html-video' | 'webcodecs' | 'mixed-video';

export interface WorkerLayerBitmapSource {
  readonly source: ImageBitmapSource;
  readonly width: number;
  readonly height: number;
  readonly release?: () => void;
  readonly decoderKind?: WorkerLayerBitmapDecoderKind;
  readonly cacheVideoElement?: HTMLVideoElement;
  readonly cacheMediaTime?: number;
  readonly cacheOwnerId?: string;
  readonly workerBitmapCacheKey?: string;
  readonly workerBitmapFrameKey?: string;
  readonly workerBitmapCacheWidth?: number;
  readonly workerBitmapCacheHeight?: number;
  readonly contentKey?: string;
  readonly driftMs?: number;
}

type WorkerLayerBitmapSkip = {
  readonly reason: WorkerSoftwarePreviewSkipReason;
  readonly driftMs?: number;
};

function unsupportedFeatureSkipReason(layer: Layer): WorkerSoftwarePreviewSkipReason | null {
  if (!canvasCompositeOperationForBlendMode(layer.blendMode)) return 'unsupported-blend-mode';
  if (!workerSoftwareEffectPlanForLayer(layer)) return 'unsupported-effects';
  if (layer.maskClipId || layer.maskFeather || layer.maskFeatherQuality || layer.maskInvert) return 'unsupported-mask';
  if (layer.transitionRender && !workerSoftwareTransitionFromLayer(layer)) return 'unsupported-transition';
  return null;
}

function isNonRenderingWorkerSoftwareSource(source: NonNullable<Layer['source']>): boolean {
  return source.type === 'camera';
}

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

function layerBitmapSource(
  layer: Layer,
  options: WorkerSoftwarePreviewFrameBuildOptions,
  depth: number,
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
      buildNestedFrame: buildWorkerSoftwarePreviewFrameInternal,
    });
  }

  if (source.textCanvas && source.textCanvas.width > 0 && source.textCanvas.height > 0) {
    return {
      source: source.textCanvas,
      width: source.textCanvas.width,
      height: source.textCanvas.height,
      contentKey: `text-canvas:${layer.id}:${source.textCanvas.width}x${source.textCanvas.height}`,
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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { readonly then?: unknown }).then === 'function';
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function layerRotationZ(layer: Layer): number {
  if (typeof layer.rotation === 'number') return layer.rotation;
  return finiteNumber(layer.rotation?.z, 0);
}

function geometryFromLayer(layer: Layer): WorkerRenderSoftwareLayerGeometry {
  return {
    position: {
      x: finiteNumber(layer.position?.x, 0),
      y: finiteNumber(layer.position?.y, 0),
    },
    scale: {
      x: finiteNumber(layer.scale?.x, 1),
      y: finiteNumber(layer.scale?.y, 1),
    },
    rotation: layerRotationZ(layer),
    sourceRect: {
      x: finiteNumber(layer.sourceRect?.x, 0),
      y: finiteNumber(layer.sourceRect?.y, 0),
      width: finiteNumber(layer.sourceRect?.width, 1),
      height: finiteNumber(layer.sourceRect?.height, 1),
    },
  };
}

function solidLayerFromLayer(layer: Layer): WorkerRenderSoftwareLayer | null {
  const source = layer.source;
  if (!source || (source.type !== 'solid' && source.type !== 'color') || !source.color) return null;
  const compositeOperation = canvasCompositeOperationForBlendMode(layer.blendMode);
  if (!compositeOperation) return null;
  const effectPlan = workerSoftwareEffectPlanForLayer(layer);
  if (!effectPlan) return null;
  const transition = workerSoftwareTransitionFromLayer(layer);
  return {
    id: layer.id,
    visible: layer.visible,
    opacity: layer.opacity,
    compositeOperation,
    filter: effectPlan.filter,
    pixelEffects: effectPlan.pixelEffects,
    ...(transition ? { transition } : {}),
    diagnosticContentKey: `solid:${layer.id}:${source.color}`,
    geometry: geometryFromLayer(layer),
    source: {
      kind: 'solid',
      color: source.color,
    },
  };
}

function adjustmentLayerFromLayer(layer: Layer): WorkerRenderSoftwareLayer | null {
  if (layer.source?.type !== 'motion-adjustment') return null;
  const rotation = layerRotationZ(layer);
  if (
    finiteNumber(layer.position?.x, 0) !== 0
    || finiteNumber(layer.position?.y, 0) !== 0
    || finiteNumber(layer.scale?.x, 1) !== 1
    || finiteNumber(layer.scale?.y, 1) !== 1
    || rotation !== 0
    || layer.transitionRender
  ) {
    return null;
  }
  const compositeOperation = canvasCompositeOperationForBlendMode(layer.blendMode);
  if (!compositeOperation) return null;
  const effectPlan = workerSoftwareEffectPlanForLayer(layer);
  if (!effectPlan) return null;
  return {
    id: layer.id,
    visible: layer.visible,
    opacity: layer.opacity,
    compositeOperation,
    filter: effectPlan.filter,
    pixelEffects: effectPlan.pixelEffects,
    geometry: geometryFromLayer(layer),
    source: { kind: 'adjustment' },
  };
}

function isTransientVideoSkipReason(reason: WorkerSoftwarePreviewSkipReason): boolean {
  return reason === 'createImageBitmap-failed' ||
    reason === 'runtime-frame-missing' ||
    reason === 'video-not-ready' ||
    reason === 'video-seeking' ||
    reason === 'video-time-drift';
}

async function bitmapLayerFromSource(
  layer: Layer,
  bitmapSource: WorkerLayerBitmapSource | WorkerLayerBitmapSkip,
  options: WorkerSoftwarePreviewFrameBuildOptions,
): Promise<
  | { readonly layer: WorkerRenderSoftwareLayer; readonly decoderKind?: WorkerLayerBitmapDecoderKind; readonly driftMs?: number }
  | WorkerLayerBitmapSkip
> {
  const compositeOperation = canvasCompositeOperationForBlendMode(layer.blendMode);
  if (!compositeOperation) return { reason: 'unsupported-blend-mode' };
  const effectPlan = workerSoftwareEffectPlanForLayer(layer);
  if (!effectPlan) return { reason: 'unsupported-effects' };
  if ('reason' in bitmapSource) {
    const heldLayer = options.heldVideoLayers?.get(layer.id);
    if (
      heldLayer &&
      isTransientVideoSkipReason(bitmapSource.reason) &&
      (heldLayer.source.kind === 'cached-bitmap' || heldLayer.source.kind === 'bitmap')
    ) {
      const transition = workerSoftwareTransitionFromLayer(layer);
      return {
        layer: {
          id: layer.id,
          visible: layer.visible,
          opacity: layer.opacity,
          compositeOperation,
          filter: effectPlan.filter,
          pixelEffects: effectPlan.pixelEffects,
          ...(transition ? { transition } : {}),
          ...(heldLayer.diagnosticContentKey ? { diagnosticContentKey: heldLayer.diagnosticContentKey } : {}),
          geometry: geometryFromLayer(layer),
          source: heldLayer.source,
        },
        decoderKind: 'html-video',
        ...(bitmapSource.driftMs !== undefined ? { driftMs: bitmapSource.driftMs } : {}),
      };
    }
    return bitmapSource;
  }
  if (
    bitmapSource.workerBitmapCacheKey &&
    options.workerBitmapCacheKeys?.has(bitmapSource.workerBitmapCacheKey)
  ) {
    const transition = workerSoftwareTransitionFromLayer(layer);
    return {
      layer: {
        id: layer.id,
        visible: layer.visible,
        opacity: layer.opacity,
        compositeOperation,
        filter: effectPlan.filter,
        pixelEffects: effectPlan.pixelEffects,
        ...(transition ? { transition } : {}),
        ...(bitmapSource.contentKey || bitmapSource.workerBitmapCacheKey
          ? { diagnosticContentKey: bitmapSource.contentKey ?? bitmapSource.workerBitmapCacheKey }
          : {}),
        geometry: geometryFromLayer(layer),
        source: {
          kind: 'cached-bitmap',
          cacheKey: bitmapSource.workerBitmapCacheKey,
          width: bitmapSource.workerBitmapCacheWidth ?? bitmapSource.width,
          height: bitmapSource.workerBitmapCacheHeight ?? bitmapSource.height,
        },
      },
      ...(bitmapSource.decoderKind ? { decoderKind: bitmapSource.decoderKind } : {}),
      ...(bitmapSource.driftMs !== undefined ? { driftMs: bitmapSource.driftMs } : {}),
    };
  }
  try {
    const snapshot = await createWorkerSoftwareBitmapSnapshot({
      source: bitmapSource.source,
      sourceWidth: bitmapSource.width,
      sourceHeight: bitmapSource.height,
      maxSize: options.maxBitmapSnapshotSize,
      resizeQuality: options.bitmapSnapshotResizeQuality,
    });
    const { bitmap } = snapshot;
    const providedWorkerBitmapCacheKey =
      bitmapSource.workerBitmapCacheKey &&
      bitmapSource.workerBitmapCacheWidth === snapshot.width &&
      bitmapSource.workerBitmapCacheHeight === snapshot.height
        ? bitmapSource.workerBitmapCacheKey
        : undefined;
    const workerBitmapCacheKey = options.workerBitmapCacheKeys
      ? providedWorkerBitmapCacheKey ?? workerSoftwareBitmapCacheKeyForSnapshot({
        ownerId: bitmapSource.cacheOwnerId,
        mediaTime: bitmapSource.cacheMediaTime,
        frameKey: bitmapSource.workerBitmapFrameKey,
        width: snapshot.width,
        height: snapshot.height,
      })
      : undefined;
    if (bitmapSource.cacheVideoElement) {
      const cacheInput: {
        video: HTMLVideoElement;
        source: ImageBitmapSource;
        width: number;
        height: number;
        mediaTime?: number;
        ownerId?: string;
        workerBitmapCacheKey?: string;
      } = {
        video: bitmapSource.cacheVideoElement,
        source: bitmap,
        width: snapshot.width,
        height: snapshot.height,
      };
      if (bitmapSource.cacheMediaTime !== undefined) {
        cacheInput.mediaTime = bitmapSource.cacheMediaTime;
      }
      if (bitmapSource.cacheOwnerId) {
        cacheInput.ownerId = bitmapSource.cacheOwnerId;
      }
      if (workerBitmapCacheKey) {
        cacheInput.workerBitmapCacheKey = workerBitmapCacheKey;
      }
      updateCachedWorkerSoftwareHtmlVideoSnapshot(cacheInput);
    }
    bitmapSource.release?.();
    const transition = workerSoftwareTransitionFromLayer(layer);
    return {
      layer: {
        id: layer.id,
        visible: layer.visible,
        opacity: layer.opacity,
        compositeOperation,
        filter: effectPlan.filter,
        pixelEffects: effectPlan.pixelEffects,
        ...(transition ? { transition } : {}),
        ...(bitmapSource.contentKey || workerBitmapCacheKey
          ? { diagnosticContentKey: bitmapSource.contentKey ?? workerBitmapCacheKey }
          : {}),
        geometry: geometryFromLayer(layer),
        source: {
          kind: 'bitmap',
          bitmap,
          width: snapshot.width,
          height: snapshot.height,
          ...(workerBitmapCacheKey ? { cacheKey: workerBitmapCacheKey } : {}),
        },
      },
      ...(bitmapSource.decoderKind ? { decoderKind: bitmapSource.decoderKind } : {}),
      ...(bitmapSource.driftMs !== undefined ? { driftMs: bitmapSource.driftMs } : {}),
    };
  } catch {
    bitmapSource.release?.();
    return { reason: 'createImageBitmap-failed' };
  }
}

function isHtmlVideoLayer(layer: Layer): boolean {
  return Boolean(layer.source?.videoElement);
}

function createSkipCounts(): Record<WorkerSoftwarePreviewSkipReason, number> {
  return {
    'createImageBitmap-failed': 0,
    'empty-image': 0,
    'empty-text-canvas': 0,
    'empty-video-frame': 0,
    invisible: 0,
    'missing-source': 0,
    'non-rendering-source': 0,
    'runtime-frame-missing': 0,
    'scrub-hold': 0,
    'unsupported-blend-mode': 0,
    'unsupported-color-correction': 0,
    'unsupported-effects': 0,
    'unsupported-mask': 0,
    'unsupported-nested-composition': 0,
    'unsupported-source': 0,
    'unsupported-transition': 0,
    'video-not-ready': 0,
    'video-seeking': 0,
    'video-time-drift': 0,
  };
}

export async function buildWorkerSoftwarePreviewFrame(
  layers: readonly Layer[],
  size: { width: number; height: number },
  options: WorkerSoftwarePreviewFrameBuildOptions = {},
): Promise<WorkerSoftwarePreviewFrameBuildResult> {
  return buildWorkerSoftwarePreviewFrameInternal(layers, size, options, 0);
}

async function buildWorkerSoftwarePreviewFrameInternal(
  layers: readonly Layer[],
  size: { width: number; height: number },
  options: WorkerSoftwarePreviewFrameBuildOptions,
  depth: number,
): Promise<WorkerSoftwarePreviewFrameBuildResult> {
  const workerLayers: WorkerRenderSoftwareLayer[] = [];
  const skippedByReason = createSkipCounts();
  let bitmapLayerCount = 0;
  let htmlVideoLayerCount = 0;
  let webCodecsLayerCount = 0;
  let forcedRuntimeFrameLayerCount = 0;
  let solidLayerCount = 0;
  let maxVideoDriftMs = 0;
  for (const layer of layers) {
    if (!layer.visible) {
      skippedByReason.invisible += 1;
      continue;
    }
    if (!layer.source) {
      skippedByReason['missing-source'] += 1;
      continue;
    }
    if (isNonRenderingWorkerSoftwareSource(layer.source)) {
      skippedByReason['non-rendering-source'] += 1;
      continue;
    }
    if (layer.source.forceRuntimeFramePreview) {
      forcedRuntimeFrameLayerCount += 1;
    }
    if (options.allowHtmlVideoSnapshots === false && isHtmlVideoLayer(layer)) {
      skippedByReason['scrub-hold'] += 1;
      continue;
    }
    const unsupportedReason = unsupportedFeatureSkipReason(layer);
    if (unsupportedReason) {
      skippedByReason[unsupportedReason] += 1;
      continue;
    }
    const solidLayer = solidLayerFromLayer(layer);
    if (solidLayer) {
      workerLayers.push(solidLayer);
      solidLayerCount += 1;
      continue;
    }
    const adjustmentLayer = adjustmentLayerFromLayer(layer);
    if (adjustmentLayer) {
      workerLayers.push(adjustmentLayer);
      continue;
    }
    const bitmapSource = layerBitmapSource(layer, options, depth);
    const bitmapResult = await bitmapLayerFromSource(
      layer,
      isPromiseLike(bitmapSource) ? await bitmapSource : bitmapSource,
      options,
    );
    if ('layer' in bitmapResult) {
      workerLayers.push(bitmapResult.layer);
      bitmapLayerCount += 1;
      if (typeof bitmapResult.driftMs === 'number' && Number.isFinite(bitmapResult.driftMs)) {
        maxVideoDriftMs = Math.max(maxVideoDriftMs, bitmapResult.driftMs);
      }
      if (bitmapResult.decoderKind === 'html-video') {
        htmlVideoLayerCount += 1;
      } else if (bitmapResult.decoderKind === 'webcodecs') {
        webCodecsLayerCount += 1;
      } else if (bitmapResult.decoderKind === 'mixed-video') {
        htmlVideoLayerCount += 1;
        webCodecsLayerCount += 1;
      }
    } else {
      if (typeof bitmapResult.driftMs === 'number' && Number.isFinite(bitmapResult.driftMs)) {
        maxVideoDriftMs = Math.max(maxVideoDriftMs, bitmapResult.driftMs);
      }
      skippedByReason[bitmapResult.reason] += 1;
    }
  }
  const skippedLayerCount = Object.values(skippedByReason).reduce((sum, count) => sum + count, 0);

  return {
    frame: {
      size: { x: Math.max(1, size.width), y: Math.max(1, size.height) },
      layers: workerLayers,
    },
    transfer: workerLayers
      .flatMap((layer) => (
        layer.source.kind === 'bitmap'
          ? [layer.source.bitmap as unknown as Transferable]
          : []
      )),
    diagnostics: {
      sourceLayerCount: layers.length,
      presentableLayerCount: workerLayers.length,
      skippedLayerCount,
      bitmapLayerCount,
      htmlVideoLayerCount,
      webCodecsLayerCount,
      forcedRuntimeFrameLayerCount,
      solidLayerCount,
      skippedByReason,
      maxVideoDriftMs,
    },
  };
}

export function hasWorkerSoftwareBlockingSkips(
  diagnostics: WorkerSoftwarePreviewFrameDiagnostics,
): boolean {
  return diagnostics.skippedLayerCount
    - diagnostics.skippedByReason.invisible
    - diagnostics.skippedByReason['non-rendering-source'] > 0;
}

export function hasOnlyTransientWorkerSoftwareSkips(
  diagnostics: WorkerSoftwarePreviewFrameDiagnostics,
): boolean {
  const blockingSkipCount = diagnostics.skippedLayerCount
    - diagnostics.skippedByReason.invisible
    - diagnostics.skippedByReason['non-rendering-source'];
  if (blockingSkipCount <= 0) return false;
  const transientSkipCount =
    diagnostics.skippedByReason['createImageBitmap-failed'] +
    diagnostics.skippedByReason['runtime-frame-missing'] +
    diagnostics.skippedByReason['video-not-ready'] +
    diagnostics.skippedByReason['video-seeking'] +
    diagnostics.skippedByReason['video-time-drift'];
  return blockingSkipCount === transientSkipCount;
}

export function closeWorkerSoftwarePreviewFrame(frame: WorkerRenderSoftwareFrame): void {
  for (const layer of frame.layers) {
    if (layer.source.kind !== 'bitmap') continue;
    try {
      layer.source.bitmap.close();
    } catch {
      // Ignore cleanup errors for transferred or already-closed bitmaps.
    }
  }
}
