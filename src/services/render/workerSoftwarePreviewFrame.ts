import type { Layer } from '../../types';
import type {
  WorkerRenderSoftwareFrame,
  WorkerRenderSoftwareLayerGeometry,
  WorkerRenderSoftwareLayer,
} from './workerRenderHostRuntimeCommands';
import {
  canvasCompositeOperationForBlendMode,
  workerSoftwareEffectPlanForLayer,
} from './workerSoftwareEffectPlan';
import { layerBitmapSource } from './workerSoftwareLayerBitmapSource';
import { createWorkerSoftwareBitmapSnapshot } from './workerSoftwareBitmapSnapshot';
import { updateCachedWorkerSoftwareHtmlVideoSnapshot, workerSoftwareBitmapCacheKeyForSnapshot } from './workerSoftwareHtmlVideoSnapshotCache';
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

/** Output frame size: blur units scale with it (effects/blur/blurSampling.ts). */
type OutputSize = { readonly width: number; readonly height: number };

export type WorkerLayerBitmapSkip = {
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

function solidLayerFromLayer(layer: Layer, size?: OutputSize): WorkerRenderSoftwareLayer | null {
  const source = layer.source;
  if (!source || (source.type !== 'solid' && source.type !== 'color') || !source.color) return null;
  const compositeOperation = canvasCompositeOperationForBlendMode(layer.blendMode);
  if (!compositeOperation) return null;
  const effectPlan = workerSoftwareEffectPlanForLayer(layer, size);
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

function adjustmentLayerFromLayer(layer: Layer, size?: OutputSize): WorkerRenderSoftwareLayer | null {
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
  const effectPlan = workerSoftwareEffectPlanForLayer(layer, size);
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
  size?: OutputSize,
): Promise<
  | { readonly layer: WorkerRenderSoftwareLayer; readonly decoderKind?: WorkerLayerBitmapDecoderKind; readonly driftMs?: number }
  | WorkerLayerBitmapSkip
> {
  const compositeOperation = canvasCompositeOperationForBlendMode(layer.blendMode);
  if (!compositeOperation) return { reason: 'unsupported-blend-mode' };
  const effectPlan = workerSoftwareEffectPlanForLayer(layer, size);
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
    const solidLayer = solidLayerFromLayer(layer, size);
    if (solidLayer) {
      workerLayers.push(solidLayer);
      solidLayerCount += 1;
      continue;
    }
    const adjustmentLayer = adjustmentLayerFromLayer(layer, size);
    if (adjustmentLayer) {
      workerLayers.push(adjustmentLayer);
      continue;
    }
    const bitmapSource = layerBitmapSource(layer, options, depth, buildWorkerSoftwarePreviewFrameInternal);
    const bitmapResult = await bitmapLayerFromSource(
      layer,
      isPromiseLike(bitmapSource) ? await bitmapSource : bitmapSource,
      options,
      size,
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
