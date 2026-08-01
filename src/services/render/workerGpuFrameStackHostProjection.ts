import { getMotionRenderSize } from '../../engine/motion/MotionTypes';
import type { Layer } from '../../types/layers';
import { createMotionMediaSourceReference } from '../motionDesign/media/sourceReferencePlanner';
import type { MotionAdjustmentRenderSurface } from '../motionDesign/adjustment/supportedEffects';
import {
  WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackIdentity,
} from './workerGpuFrameStackContract';
import type {
  WorkerGpuFrameStackHostSource,
  WorkerGpuFrameStackProjectionRequest,
} from './workerGpuFrameStackProjector';
import type { WorkerGpuRenderIntent } from './workerGpuRuntimeCommands';

export type WorkerGpuFrameStackResolvedVideoSource =
  | {
      readonly kind: 'webcodecs';
      readonly sourceId: string;
      readonly mediaTime: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'bitmap';
      readonly sourceId: string;
      readonly source: ImageBitmapSource;
      readonly width: number;
      readonly height: number;
    };

export type WorkerGpuFrameStackResolvedSource =
  | WorkerGpuFrameStackResolvedVideoSource
  | {
      readonly kind: 'bitmap';
      readonly sourceId: string;
      readonly runtimeSourceKind: 'image' | 'text';
      readonly source: ImageBitmapSource;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'solid';
      readonly sourceId: string;
      readonly runtimeSourceKind: 'solid' | 'color';
      readonly color: string;
      readonly width: number;
      readonly height: number;
    };

export interface WorkerGpuFrameStackHostProjectionInput {
  /** Evaluated LayerBuilder order is top-to-bottom. */
  readonly layers: readonly Layer[];
  readonly width: number;
  readonly height: number;
  readonly frame: WorkerGpuFrameStackIdentity;
  readonly occurrenceNamespace: string;
  readonly intent: WorkerGpuRenderIntent;
  readonly surface: MotionAdjustmentRenderSurface;
  readonly nowMs: number;
  readonly resolveVideoSource: (
    layer: Layer,
  ) => WorkerGpuFrameStackResolvedVideoSource | null;
  /** Optional host-side raw-raster ingestion for non-video sources. */
  readonly resolveSource?: (
    layer: Layer,
  ) => WorkerGpuFrameStackResolvedSource | null;
}

export class WorkerGpuFrameStackHostProjectionError extends Error {
  readonly layerId: string;

  constructor(layerId: string, message: string) {
    super(`[MD7_FRAME_STACK_HOST_SOURCE_UNSUPPORTED] ${message} (layer '${layerId}')`);
    this.name = 'WorkerGpuFrameStackHostProjectionError';
    this.layerId = layerId;
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function stableLayerSourceId(prefix: string, layer: Layer): string {
  return `${prefix}:${layer.sourceClipId ?? layer.id}`;
}

function bitmapDimensions(
  source: ImageBitmapSource,
): { readonly width: number; readonly height: number } | null {
  if (typeof source !== 'object' || source === null) return null;
  const record = source as unknown as Record<string, unknown>;
  const candidates = [
    [record.videoWidth, record.videoHeight],
    [record.displayWidth, record.displayHeight],
    [record.naturalWidth, record.naturalHeight],
    [record.width, record.height],
    [record.codedWidth, record.codedHeight],
  ] as const;
  for (const [width, height] of candidates) {
    if (positiveInteger(width) && positiveInteger(height)) return { width, height };
  }
  return null;
}

function bitmapSource(
  layer: Layer,
  source: ImageBitmapSource | undefined,
  runtimeSourceKind: 'image' | 'text',
): WorkerGpuFrameStackHostSource {
  if (!source) {
    throw new WorkerGpuFrameStackHostProjectionError(
      layer.id,
      `${runtimeSourceKind} has no exact raw bitmap source`,
    );
  }
  const dimensions = bitmapDimensions(source);
  if (!dimensions) {
    throw new WorkerGpuFrameStackHostProjectionError(
      layer.id,
      `${runtimeSourceKind} has no positive intrinsic dimensions`,
    );
  }
  return {
    kind: 'bitmap',
    layerId: layer.id,
    sourceId: stableLayerSourceId(runtimeSourceKind, layer),
    runtimeSourceKind,
    source,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
  };
}

function resolvedSource(
  layer: Layer,
  source: WorkerGpuFrameStackResolvedSource,
): WorkerGpuFrameStackHostSource {
  if (source.kind === 'webcodecs') {
    return {
      kind: 'webcodecs', layerId: layer.id, sourceId: source.sourceId,
      runtimeSourceKind: 'video', mediaTime: source.mediaTime,
      width: source.width, height: source.height,
    };
  }
  if (source.kind === 'solid') {
    return {
      kind: 'solid', layerId: layer.id, sourceId: source.sourceId,
      runtimeSourceKind: source.runtimeSourceKind,
      width: source.width, height: source.height,
    };
  }
  return {
    kind: 'bitmap', layerId: layer.id, sourceId: source.sourceId,
    runtimeSourceKind: 'runtimeSourceKind' in source ? source.runtimeSourceKind : 'video', source: source.source,
    sourceWidth: source.width, sourceHeight: source.height,
  };
}
function buildSources(
  input: WorkerGpuFrameStackHostProjectionInput,
  ancestry: ReadonlySet<string>,
  depth: number,
): readonly WorkerGpuFrameStackHostSource[] {
  const sources: WorkerGpuFrameStackHostSource[] = [];
  for (const layer of input.layers) {
    if (!layer.visible || layer.opacity <= 0 || !layer.source) continue;
    const source = layer.source;
    if (source.type === 'motion-adjustment') continue;

    if (source.nestedComposition) {
      const nested = source.nestedComposition;
      if (!Number.isFinite(nested.currentTime)) {
        throw new WorkerGpuFrameStackHostProjectionError(
          layer.id,
          'nested composition has no exact local frame time',
        );
      }
      const occurrenceNamespace = createWorkerGpuNestedOccurrenceNamespace(
        input.occurrenceNamespace,
        layer.sourceClipId ?? layer.id,
      );
      const runtimeSourceKind = source.type === 'motion'
        ? 'motionNestedComposition' as const
        : 'nestedComposition' as const;
      sources.push({
        kind: 'nested-stack',
        layerId: layer.id,
        sourceId: runtimeSourceKind === 'motionNestedComposition'
          ? `motion-media-source/v1:nested-composition:${encodeURIComponent(nested.compositionId)}`
          : `nested-composition:${nested.compositionId}`,
        runtimeSourceKind,
        request: buildRequest(
          {
            ...input,
            layers: nested.layers,
            width: nested.width,
            height: nested.height,
            occurrenceNamespace,
            surface: input.surface === 'export' ? 'export' : 'nested-preview',
            frame: {
              ...input.frame,
              compositionId: nested.compositionId,
              timelineTime: nested.currentTime!,
            },
          },
          ancestry,
          depth + 1,
        ),
      });
      continue;
    }

    const resolved = input.resolveSource?.(layer);
    if (resolved) {
      sources.push(resolvedSource(layer, resolved));
      continue;
    }

    switch (source.type) {
      case 'video': {
        const resolved = input.resolveVideoSource(layer);
        if (!resolved) {
          throw new WorkerGpuFrameStackHostProjectionError(
            layer.id,
            'video has neither an admitted Worker WebCodecs source nor an exact bitmap frame',
          );
        }
        if (resolved.kind === 'webcodecs') {
          sources.push({
            kind: 'webcodecs',
            layerId: layer.id,
            sourceId: resolved.sourceId,
            runtimeSourceKind: 'video',
            mediaTime: resolved.mediaTime,
            width: resolved.width,
            height: resolved.height,
          });
        } else {
          sources.push({
            kind: 'bitmap',
            layerId: layer.id,
            sourceId: resolved.sourceId,
            runtimeSourceKind: 'video',
            source: resolved.source,
            sourceWidth: resolved.width,
            sourceHeight: resolved.height,
          });
        }
        break;
      }
      case 'image':
        sources.push(bitmapSource(layer, source.imageElement, 'image'));
        break;
      case 'text':
        sources.push(bitmapSource(layer, source.textCanvas, 'text'));
        break;
      case 'solid':
      case 'color': {
        const width = positiveInteger(source.intrinsicWidth) ? source.intrinsicWidth : input.width;
        const height = positiveInteger(source.intrinsicHeight) ? source.intrinsicHeight : input.height;
        sources.push({
          kind: 'solid',
          layerId: layer.id,
          sourceId: stableLayerSourceId(source.type, layer),
          runtimeSourceKind: source.type,
          width,
          height,
        });
        break;
      }
      case 'motion': {
        if (!source.motion || source.motion.kind !== 'shape') {
          throw new WorkerGpuFrameStackHostProjectionError(
            layer.id,
            'only admitted Motion shape pixels can enter the Worker GPU frame stack',
          );
        }
        const dimensions = getMotionRenderSize(source.motion);
        sources.push({
          kind: 'motion',
          layerId: layer.id,
          sourceId: createMotionMediaSourceReference(
            'image',
            layer.sourceClipId ?? layer.id,
            null,
          ).sourceId,
          runtimeSourceKind: 'motion',
          width: dimensions.width,
          height: dimensions.height,
        });
        break;
      }
      default:
        throw new WorkerGpuFrameStackHostProjectionError(
          layer.id,
          `source kind '${source.type}' is not a supported 2D frame-stack source`,
        );
    }
  }
  return sources;
}

function buildRequest(
  input: WorkerGpuFrameStackHostProjectionInput,
  parentAncestry: ReadonlySet<string>,
  depth: number,
): WorkerGpuFrameStackProjectionRequest {
  if (
    depth > WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH
    || parentAncestry.has(input.frame.compositionId)
  ) {
    throw new WorkerGpuFrameStackHostProjectionError(
      input.frame.compositionId,
      'nested composition cycle or depth limit exceeded',
    );
  }
  const ancestry = new Set(parentAncestry);
  ancestry.add(input.frame.compositionId);
  return {
    layers: input.layers,
    sources: buildSources(input, ancestry, depth),
    width: input.width,
    height: input.height,
    frame: input.frame,
    occurrenceNamespace: input.occurrenceNamespace,
    intent: input.intent,
    surface: input.surface,
    nowMs: input.nowMs,
  };
}

export function buildWorkerGpuFrameStackProjectionRequest(
  input: WorkerGpuFrameStackHostProjectionInput,
): WorkerGpuFrameStackProjectionRequest {
  return buildRequest(input, new Set<string>(), 0);
}
