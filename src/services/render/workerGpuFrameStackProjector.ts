import type { Layer } from '../../types/layers';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import type { MotionAdjustmentSourceKind } from '../motionDesign/adjustment/sourceContracts';
import type { MotionAdjustmentRenderSurface } from '../motionDesign/adjustment/supportedEffects';
import { isMotionAdjustmentStableId } from '../motionDesign/adjustment/contractLimits';
import { MOTION_MEDIA_MAX_RENDER_DIMENSION } from '../motionDesign/media/contracts';
import {
  buildWorkerGpuAdjustmentExecutionPlan,
  type WorkerGpuAdjustmentRuntimeSourceKind,
  type WorkerGpuAdjustmentSourceBinding,
} from './workerGpuAdjustmentPlanAdapter';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH,
  WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS,
  WORKER_GPU_FRAME_STACK_MAX_TOTAL_PIXELS,
  assertWorkerGpuFrameStackContract,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackIdentity,
  type WorkerGpuFrameStackPayload,
  type WorkerGpuFrameStackRuntimeSourceKind,
  type WorkerGpuFrameStackSourceBinding,
} from './workerGpuFrameStackContract';
import { cloneWorkerGpuRenderLayer } from './workerGpuMediaSourceRegistry';
import type { WorkerGpuRenderIntent } from './workerGpuRuntimeCommands';
import {
  createWorkerSoftwareBitmapSnapshot,
  type WorkerSoftwareBitmapSnapshot,
  type WorkerSoftwareBitmapSnapshotInput,
} from './workerSoftwareBitmapSnapshot';

export type WorkerGpuFrameStackProjectionDiagnosticCode =
  | 'MD7_FRAME_STACK_PROJECTOR_DUPLICATE_SOURCE'
  | 'MD7_FRAME_STACK_PROJECTOR_UNKNOWN_SOURCE'
  | 'MD7_FRAME_STACK_PROJECTOR_MISSING_SOURCE'
  | 'MD7_FRAME_STACK_PROJECTOR_INACTIVE_SOURCE'
  | 'MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE'
  | 'MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH'
  | 'MD7_FRAME_STACK_PROJECTOR_SOURCE_ID_INVALID'
  | 'MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH'
  | 'MD7_FRAME_STACK_PROJECTOR_BITMAP_SNAPSHOT_FAILED'
  | 'MD7_FRAME_STACK_PROJECTOR_BITMAP_OWNERSHIP_INVALID'
  | 'MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH'
  | 'MD7_FRAME_STACK_PROJECTOR_PLAN_FAILED'
  | 'MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED';

const DIAGNOSTIC_MESSAGES = {
  MD7_FRAME_STACK_PROJECTOR_DUPLICATE_SOURCE: 'The host frame-stack source record is duplicated',
  MD7_FRAME_STACK_PROJECTOR_UNKNOWN_SOURCE: 'The host frame-stack source record has no matching layer',
  MD7_FRAME_STACK_PROJECTOR_MISSING_SOURCE: 'An admitted host frame-stack layer has no source record',
  MD7_FRAME_STACK_PROJECTOR_INACTIVE_SOURCE: 'An inactive host layer cannot own a frame-stack source record',
  MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE: 'The host layer source cannot be projected to the Worker GPU stack',
  MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH: 'The host source record does not match its evaluated layer kind',
  MD7_FRAME_STACK_PROJECTOR_SOURCE_ID_INVALID: 'The host source record has no stable source identity',
  MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH: 'The host frame-stack request is not one exact frozen frame',
  MD7_FRAME_STACK_PROJECTOR_BITMAP_SNAPSHOT_FAILED: 'The host could not snapshot the raw bitmap source',
  MD7_FRAME_STACK_PROJECTOR_BITMAP_OWNERSHIP_INVALID: 'The host bitmap snapshot does not have unique transferred ownership',
  MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH: 'The nested host request does not match its parent occurrence',
  MD7_FRAME_STACK_PROJECTOR_PLAN_FAILED: 'The host could not freeze the Adjustment execution plan',
  MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED: 'The projected Worker GPU frame stack was rejected by its contract',
} as const satisfies Record<WorkerGpuFrameStackProjectionDiagnosticCode, string>;

export class WorkerGpuFrameStackProjectionError extends Error {
  readonly code: WorkerGpuFrameStackProjectionDiagnosticCode;
  readonly path: string;

  constructor(code: WorkerGpuFrameStackProjectionDiagnosticCode, path: string) {
    super(`[${code}] ${DIAGNOSTIC_MESSAGES[code]} at ${path}`);
    this.name = 'WorkerGpuFrameStackProjectionError';
    this.code = code;
    this.path = path;
  }
}

interface HostSourceBase {
  readonly layerId: string;
  readonly sourceId: string;
  readonly runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind;
}

export type WorkerGpuFrameStackHostSource =
  | (HostSourceBase & {
      readonly kind: 'webcodecs';
      readonly runtimeSourceKind: 'video' | 'motionVideo';
      readonly mediaTime: number;
      readonly width: number;
      readonly height: number;
    })
  | (HostSourceBase & {
      readonly kind: 'bitmap';
      readonly runtimeSourceKind: 'video' | 'image' | 'text' | 'motionImage';
      readonly source: ImageBitmapSource;
      readonly sourceWidth: number;
      readonly sourceHeight: number;
    })
  | (HostSourceBase & {
      readonly kind: 'solid';
      readonly runtimeSourceKind: 'solid' | 'color';
      readonly width: number;
      readonly height: number;
    })
  | (HostSourceBase & {
      readonly kind: 'motion';
      readonly runtimeSourceKind: 'motion';
      readonly width: number;
      readonly height: number;
    })
  | (HostSourceBase & {
      readonly kind: 'nested-stack';
      readonly runtimeSourceKind: 'nestedComposition' | 'motionNestedComposition';
      readonly request: WorkerGpuFrameStackProjectionRequest;
    });

export interface WorkerGpuFrameStackProjectionRequest {
  /** Evaluated LayerBuilder order is top-to-bottom. */
  readonly layers: readonly Layer[];
  /** Exactly one record for every visible, non-zero-opacity pixel source. */
  readonly sources: readonly WorkerGpuFrameStackHostSource[];
  readonly width: number;
  readonly height: number;
  readonly frame: WorkerGpuFrameStackIdentity;
  readonly occurrenceNamespace: string;
  readonly intent: WorkerGpuRenderIntent;
  readonly surface: MotionAdjustmentRenderSurface;
  readonly nowMs: number;
}

export interface WorkerGpuFrameStackProjectorInput
  extends WorkerGpuFrameStackProjectionRequest {
  /** Injectable for deterministic tests; production uses the raw snapshot helper. */
  readonly snapshotBitmap?: (
    input: WorkerSoftwareBitmapSnapshotInput,
  ) => Promise<WorkerSoftwareBitmapSnapshot>;
  /** Monotonic admission clock. Production defaults to Date.now. */
  readonly clock?: () => number;
}

interface ProjectionContext {
  readonly snapshotBitmap: (
    input: WorkerSoftwareBitmapSnapshotInput,
  ) => Promise<WorkerSoftwareBitmapSnapshot>;
  readonly createdBitmaps: Set<ImageBitmap>;
  readonly borrowedBitmapSources: Set<object>;
  readonly clock: () => number;
  readonly budget: {
    totalBindings: number;
    totalPixels: number;
    readonly compositionAncestry: Set<string>;
  };
}

type PreparedPayload =
  | Extract<WorkerGpuFrameStackPayload, { readonly kind: 'webcodecs' | 'solid' | 'motion' }>
  | {
      readonly kind: 'bitmap-source';
      readonly source: ImageBitmapSource;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'nested-prepared';
      readonly reference: {
        readonly sourceId: string;
        readonly compositionId: string;
        readonly localTimelineTime: number;
        readonly occurrenceNamespace: string;
      };
      readonly stack: PreparedStack;
    };

interface PreparedBinding {
  readonly layerId: string;
  readonly runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind;
  readonly sourceKind: MotionAdjustmentSourceKind;
  readonly sourceId: string;
  readonly renderLayer: WorkerGpuFrameStackSourceBinding['renderLayer'];
  readonly payload: PreparedPayload;
}

interface PreparedStack {
  readonly occurrenceNamespace: string;
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly frame: WorkerGpuFrameStackIdentity;
  readonly execution: WorkerGpuFrameStackContractV1['execution'];
  readonly bindings: readonly PreparedBinding[];
}

function fail(
  code: WorkerGpuFrameStackProjectionDiagnosticCode,
  path: string,
): never {
  throw new WorkerGpuFrameStackProjectionError(code, path);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isStableSourceId(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || value.trim() !== value
  ) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || (codeUnit >= 127 && codeUnit <= 159)) return false;
  }
  return true;
}

function activeSourceLayers(layers: readonly Layer[]): readonly Layer[] {
  return layers.filter((layer) => (
    layer.visible
    && layer.opacity > 0
    && layer.source != null
    && layer.source.type !== 'motion-adjustment'
  ));
}

function runtimeSourceKindFromLayer(
  layer: Layer,
): WorkerGpuAdjustmentRuntimeSourceKind | null {
  if (!layer.source) return null;
  if (layer.source.nestedComposition) return 'nestedComposition';
  return layer.source.type;
}

function sourceKindFromHostRuntime(
  runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind,
): MotionAdjustmentSourceKind {
  switch (runtimeSourceKind) {
    case 'video':
    case 'image':
    case 'solid':
    case 'color':
      return 'timeline-media';
    case 'text':
      return 'title';
    case 'motion':
    case 'motionVideo':
    case 'motionImage':
    case 'motionNestedComposition':
      return 'motion-media';
    case 'nestedComposition':
      return 'nested-composition';
  }
}

function hostSourceMatchesLayer(
  source: WorkerGpuFrameStackHostSource,
  layer: Layer,
): boolean {
  const runtimeKind = runtimeSourceKindFromLayer(layer);
  if (runtimeKind === 'nestedComposition') {
    return source.runtimeSourceKind === (
      layer.source?.type === 'motion'
        ? 'motionNestedComposition'
        : 'nestedComposition'
    );
  }
  return source.runtimeSourceKind === runtimeKind;
}

function isExpectedPayloadKind(
  runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind,
  payloadKind: WorkerGpuFrameStackHostSource['kind'],
): boolean {
  switch (runtimeSourceKind) {
    case 'video':
      return payloadKind === 'webcodecs' || payloadKind === 'bitmap';
    case 'motionVideo':
      return payloadKind === 'webcodecs';
    case 'image':
    case 'text':
    case 'motionImage':
      return payloadKind === 'bitmap';
    case 'solid':
    case 'color':
      return payloadKind === 'solid';
    case 'motion':
      return payloadKind === 'motion';
    case 'nestedComposition':
    case 'motionNestedComposition':
      return payloadKind === 'nested-stack';
  }
}

function closeCreatedBitmaps(bitmaps: ReadonlySet<ImageBitmap>): void {
  for (const bitmap of bitmaps) {
    try {
      bitmap.close();
    } catch {
      // Projection failure still consumes every newly-created host snapshot.
    }
  }
}

function assertProjectionDimensions(
  width: unknown,
  height: unknown,
  path: string,
  context: ProjectionContext,
): void {
  if (
    !isPositiveInteger(width)
    || !isPositiveInteger(height)
    || width > MOTION_MEDIA_MAX_RENDER_DIMENSION
    || height > MOTION_MEDIA_MAX_RENDER_DIMENSION
  ) {
    fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', path);
  }
  context.budget.totalPixels += width * height;
  if (
    !Number.isSafeInteger(context.budget.totalPixels)
    || context.budget.totalPixels > WORKER_GPU_FRAME_STACK_MAX_TOTAL_PIXELS
  ) {
    fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', path);
  }
}

function assertNotExpired(
  frame: WorkerGpuFrameStackIdentity,
  path: string,
  context: ProjectionContext,
): number {
  const nowMs = context.clock();
  if (!isFiniteNumber(nowMs) || nowMs >= frame.expireAfterMs) {
    fail('MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH', path);
  }
  return nowMs;
}

function cloneFrozenRenderLayer(
  layer: Layer,
  path: string,
): WorkerGpuFrameStackSourceBinding['renderLayer'] {
  try {
    return structuredClone(cloneWorkerGpuRenderLayer(layer));
  } catch {
    return fail('MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE', path);
  }
}

function hasUnsupportedDirectSemantics(layer: Layer, hasAdjustment: boolean): boolean {
  return layer.is3D === true
    || layer.wireframe === true
    || layer.maskClipId !== undefined
    || (!hasAdjustment && (layer.masks?.length ?? 0) > 0);
}

function isFrameStackIntent(value: unknown): value is WorkerGpuRenderIntent {
  return value === 'playback'
    || value === 'scrub'
    || value === 'seek'
    || value === 'preview'
    || value === 'export'
    || value === 'proof';
}

function isAdjustmentSurface(value: unknown): value is MotionAdjustmentRenderSurface {
  return value === 'preview'
    || value === 'nested-preview'
    || value === 'target-preview'
    || value === 'export';
}

function bitmapSourceDimensions(
  source: ImageBitmapSource,
): { readonly width: number; readonly height: number } | null {
  if (typeof source !== 'object' || source === null) return null;
  try {
    const record = source as unknown as Record<string, unknown>;
    const candidates = [
      [record.videoWidth, record.videoHeight],
      [record.displayWidth, record.displayHeight],
      [record.naturalWidth, record.naturalHeight],
      [record.width, record.height],
      [record.codedWidth, record.codedHeight],
    ] as const;
    for (const [width, height] of candidates) {
      if (isPositiveInteger(width) && isPositiveInteger(height)) return { width, height };
    }
  } catch {
    return null;
  }
  return null;
}

function motionDefinition(layer: Layer, path: string): MotionLayerDefinition {
  const definition = layer.source?.type === 'motion' ? layer.source.motion : undefined;
  if (!definition) fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
  try {
    return structuredClone(definition);
  } catch {
    return fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
  }
}

function planRuntimeKind(layer: Layer, path: string): WorkerGpuAdjustmentRuntimeSourceKind {
  const runtimeKind = runtimeSourceKindFromLayer(layer);
  switch (runtimeKind) {
    case 'video':
    case 'image':
    case 'solid':
    case 'color':
    case 'text':
    case 'motion':
    case 'nestedComposition':
      return runtimeKind;
    default:
      return fail('MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE', path);
  }
}

function assertFrameRequest(
  request: WorkerGpuFrameStackProjectionRequest,
  path: string,
  context: ProjectionContext,
): void {
  if (
    request.intent !== request.frame.intent
    || !isFrameStackIntent(request.intent)
    || !isAdjustmentSurface(request.surface)
    || request.frame.exact !== true
    || !isMotionAdjustmentStableId(request.frame.requestId)
    || !isMotionAdjustmentStableId(request.frame.targetId)
    || !isMotionAdjustmentStableId(request.frame.compositionId)
    || !isMotionAdjustmentStableId(request.occurrenceNamespace)
    || !isFiniteNumber(request.frame.timelineTime)
    || !Number.isSafeInteger(request.frame.frameIndex)
    || request.frame.frameIndex < 0
    || !Number.isSafeInteger(request.frame.graphVersion)
    || request.frame.graphVersion < 0
    || !isFiniteNumber(request.nowMs)
    || !isFiniteNumber(request.frame.submitByMs)
    || !isFiniteNumber(request.frame.expireAfterMs)
    || request.frame.expireAfterMs <= request.frame.submitByMs
    || request.nowMs >= request.frame.expireAfterMs
  ) {
    fail('MD7_FRAME_STACK_PROJECTOR_FRAME_MISMATCH', path);
  }
  assertNotExpired(request.frame, `${path}.frame`, context);
}

function preparePayload(
  source: WorkerGpuFrameStackHostSource,
  layer: Layer,
  request: WorkerGpuFrameStackProjectionRequest,
  context: ProjectionContext,
  path: string,
  depth: number,
): PreparedPayload {
  if (!isExpectedPayloadKind(source.runtimeSourceKind, source.kind)) {
    fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', `${path}.kind`);
  }
  switch (source.kind) {
    case 'webcodecs': {
      const evaluatedTime = layer.source?.mediaTime ?? layer.source?.targetMediaTime;
      if (
        !isFiniteNumber(source.mediaTime)
        || (evaluatedTime !== undefined && evaluatedTime !== source.mediaTime)
        || !isPositiveInteger(source.width)
        || !isPositiveInteger(source.height)
      ) {
        fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
      }
      assertProjectionDimensions(source.width, source.height, path, context);
      return {
        kind: 'webcodecs',
        mediaTime: source.mediaTime,
        width: source.width,
        height: source.height,
      };
    }
    case 'bitmap': {
      if (!isPositiveInteger(source.sourceWidth) || !isPositiveInteger(source.sourceHeight)) {
        fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
      }
      const sourceDimensions = bitmapSourceDimensions(source.source);
      if (
        !sourceDimensions
        || sourceDimensions.width !== source.sourceWidth
        || sourceDimensions.height !== source.sourceHeight
      ) {
        fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
      }
      context.borrowedBitmapSources.add(source.source as object);
      assertProjectionDimensions(source.sourceWidth, source.sourceHeight, path, context);
      return {
        kind: 'bitmap-source',
        source: source.source,
        width: source.sourceWidth,
        height: source.sourceHeight,
      };
    }
    case 'solid': {
      const color = layer.source?.color;
      if (
        typeof color !== 'string'
        || !isPositiveInteger(source.width)
        || !isPositiveInteger(source.height)
      ) {
        fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
      }
      assertProjectionDimensions(source.width, source.height, path, context);
      return {
        kind: 'solid',
        color,
        width: source.width,
        height: source.height,
      };
    }
    case 'motion':
      if (!isPositiveInteger(source.width) || !isPositiveInteger(source.height)) {
        fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', path);
      }
      assertProjectionDimensions(source.width, source.height, path, context);
      return {
        kind: 'motion',
        definition: motionDefinition(layer, path),
        timelineTime: request.frame.timelineTime,
        width: source.width,
        height: source.height,
      };
    case 'nested-stack': {
      const stableLayerId = layer.sourceClipId ?? layer.id;
      const nested = layer.source?.nestedComposition;
      const expectedNamespace = createWorkerGpuNestedOccurrenceNamespace(
        request.occurrenceNamespace,
        stableLayerId,
      );
      const expectedSourceId = source.runtimeSourceKind === 'motionNestedComposition'
        ? `motion-media-source/v1:nested-composition:${encodeURIComponent(nested?.compositionId ?? '')}`
        : `nested-composition:${nested?.compositionId ?? ''}`;
      if (
        !nested
        || !isFiniteNumber(nested.currentTime)
        || source.sourceId !== expectedSourceId
        || source.request.layers !== nested.layers
        || source.request.width !== nested.width
        || source.request.height !== nested.height
        || source.request.occurrenceNamespace !== expectedNamespace
        || source.request.frame.requestId !== request.frame.requestId
        || source.request.frame.targetId !== request.frame.targetId
        || source.request.frame.compositionId !== nested.compositionId
        || source.request.frame.timelineTime !== nested.currentTime
        || source.request.frame.frameIndex !== request.frame.frameIndex
        || source.request.frame.intent !== request.frame.intent
        || source.request.frame.submitByMs !== request.frame.submitByMs
        || source.request.frame.expireAfterMs !== request.frame.expireAfterMs
        || source.request.frame.graphVersion !== request.frame.graphVersion
        || source.request.intent !== request.intent
        || source.request.surface !== (request.surface === 'export' ? 'export' : 'nested-preview')
        || source.request.nowMs !== request.nowMs
      ) {
        fail('MD7_FRAME_STACK_PROJECTOR_NESTED_REFERENCE_MISMATCH', path);
      }
      const stack = prepareStack(source.request, context, `${path}.request`, depth + 1);
      return {
        kind: 'nested-prepared',
        reference: {
          sourceId: source.sourceId,
          compositionId: nested.compositionId,
          localTimelineTime: nested.currentTime,
          occurrenceNamespace: expectedNamespace,
        },
        stack,
      };
    }
  }
}

function prepareStack(
  request: WorkerGpuFrameStackProjectionRequest,
  context: ProjectionContext,
  path: string,
  depth: number,
): PreparedStack {
  if (depth > WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH) {
    fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', path);
  }
  assertFrameRequest(request, path, context);
  assertProjectionDimensions(request.width, request.height, `${path}.dimensions`, context);
  if (context.budget.compositionAncestry.has(request.frame.compositionId)) {
    fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', `${path}.frame.compositionId`);
  }
  context.budget.compositionAncestry.add(request.frame.compositionId);
  const layersById = new Map<string, Layer>();
  request.layers.forEach((layer, index) => {
    if (layersById.has(layer.id)) {
      fail('MD7_FRAME_STACK_PROJECTOR_DUPLICATE_SOURCE', `${path}.layers[${index}].id`);
    }
    layersById.set(layer.id, layer);
  });

  const activeLayers = activeSourceLayers(request.layers);
  context.budget.totalBindings += activeLayers.length;
  if (context.budget.totalBindings > WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS) {
    fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', `${path}.bindings`);
  }
  const activeLayerIds = new Set(activeLayers.map((layer) => layer.id));
  const sourcesByLayerId = new Map<string, WorkerGpuFrameStackHostSource>();
  request.sources.forEach((source, index) => {
    if (!isStableSourceId(source.sourceId)) {
      fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_ID_INVALID', `${path}.sources[${index}].sourceId`);
    }
    if (sourcesByLayerId.has(source.layerId)) {
      fail('MD7_FRAME_STACK_PROJECTOR_DUPLICATE_SOURCE', `${path}.sources[${index}].layerId`);
    }
    const layer = layersById.get(source.layerId);
    if (!layer) fail('MD7_FRAME_STACK_PROJECTOR_UNKNOWN_SOURCE', `${path}.sources[${index}]`);
    if (!activeLayerIds.has(source.layerId)) {
      fail('MD7_FRAME_STACK_PROJECTOR_INACTIVE_SOURCE', `${path}.sources[${index}]`);
    }
    if (!hostSourceMatchesLayer(source, layer)) {
      fail('MD7_FRAME_STACK_PROJECTOR_SOURCE_KIND_MISMATCH', `${path}.sources[${index}]`);
    }
    sourcesByLayerId.set(source.layerId, source);
  });

  const bottomToTopLayers = [...activeLayers].reverse();
  const hasAdjustment = request.layers.some((layer) => (
    layer.visible
    && layer.opacity > 0
    && layer.source?.type === 'motion-adjustment'
  ));
  const unsupportedLayer = activeLayers.find((layer) => (
    hasUnsupportedDirectSemantics(layer, hasAdjustment)
  ));
  if (unsupportedLayer) {
    fail('MD7_FRAME_STACK_PROJECTOR_UNSUPPORTED_SOURCE', `${path}.layers.${unsupportedLayer.id}`);
  }
  const bindings: PreparedBinding[] = [];
  const planBindings: WorkerGpuAdjustmentSourceBinding[] = [];
  try {
    for (let index = 0; index < bottomToTopLayers.length; index += 1) {
      const layer = bottomToTopLayers[index];
      const source = sourcesByLayerId.get(layer.id);
      if (!source) {
        fail('MD7_FRAME_STACK_PROJECTOR_MISSING_SOURCE', `${path}.layers.${layer.id}`);
      }
      const runtimeKind = planRuntimeKind(layer, `${path}.layers.${layer.id}`);
      planBindings.push({
        layerId: layer.id,
        sourceKind: runtimeKind,
        sourceId: source.sourceId,
      });
      bindings.push({
        layerId: layer.sourceClipId ?? layer.id,
        runtimeSourceKind: source.runtimeSourceKind,
        sourceKind: sourceKindFromHostRuntime(source.runtimeSourceKind),
        sourceId: source.sourceId,
        renderLayer: cloneFrozenRenderLayer(layer, `${path}.layers.${layer.id}`),
        payload: preparePayload(
          source,
          layer,
          request,
          context,
          `${path}.sources.${source.layerId}`,
          depth,
        ),
      });
    }

    let execution: WorkerGpuFrameStackContractV1['execution'];
    if (hasAdjustment) {
      let plan;
      try {
        plan = buildWorkerGpuAdjustmentExecutionPlan({
          layers: request.layers,
          sourceBindings: planBindings,
          frameContext: {
            compositionId: request.frame.compositionId,
            timelineTimeSeconds: request.frame.timelineTime,
          },
          requestId: request.frame.requestId,
          targetId: request.frame.targetId,
          frameIndex: request.frame.frameIndex,
          intent: request.intent,
          nowMs: request.frame.submitByMs,
          frameIdentity: { ...request.frame },
          resourceNamespace: request.occurrenceNamespace,
          surface: request.surface,
        });
      } catch {
        return fail('MD7_FRAME_STACK_PROJECTOR_PLAN_FAILED', `${path}.execution`);
      }
      if (!plan) fail('MD7_FRAME_STACK_PROJECTOR_PLAN_FAILED', `${path}.execution`);
      execution = { kind: 'frozen-adjustment', plan };
      const intermediateCount = plan.resources.filter((resource) => resource.kind !== 'source').length;
      for (let index = 0; index < intermediateCount; index += 1) {
        assertProjectionDimensions(request.width, request.height, `${path}.execution.resources`, context);
      }
    } else {
      execution = {
        kind: 'ordered-sources',
        bottomToTopLayerIds: bindings.map((binding) => binding.layerId),
      };
    }

    return {
      occurrenceNamespace: request.occurrenceNamespace,
      dimensions: { width: request.width, height: request.height },
      frame: { ...request.frame, exact: true },
      execution,
      bindings,
    };
  } finally {
    context.budget.compositionAncestry.delete(request.frame.compositionId);
  }
}

async function realizePayload(
  payload: PreparedPayload,
  frame: WorkerGpuFrameStackIdentity,
  context: ProjectionContext,
  path: string,
): Promise<WorkerGpuFrameStackPayload> {
  if (payload.kind === 'bitmap-source') {
    assertNotExpired(frame, path, context);
    let snapshot: WorkerSoftwareBitmapSnapshot;
    try {
      snapshot = await context.snapshotBitmap({
        source: payload.source,
        sourceWidth: payload.width,
        sourceHeight: payload.height,
        maxSize: { width: payload.width, height: payload.height },
      });
    } catch {
      return fail('MD7_FRAME_STACK_PROJECTOR_BITMAP_SNAPSHOT_FAILED', path);
    }
    if (
      context.borrowedBitmapSources.has(snapshot.bitmap as object)
      || context.createdBitmaps.has(snapshot.bitmap)
    ) {
      fail('MD7_FRAME_STACK_PROJECTOR_BITMAP_OWNERSHIP_INVALID', path);
    }
    context.createdBitmaps.add(snapshot.bitmap);
    assertNotExpired(frame, path, context);
    if (
      snapshot.width !== payload.width
      || snapshot.height !== payload.height
      || snapshot.bitmap.width !== payload.width
      || snapshot.bitmap.height !== payload.height
    ) {
      fail('MD7_FRAME_STACK_PROJECTOR_BITMAP_SNAPSHOT_FAILED', path);
    }
    return {
      kind: 'bitmap',
      bitmap: snapshot.bitmap,
      width: snapshot.width,
      height: snapshot.height,
      ownership: 'transferred-once',
    };
  }
  if (payload.kind === 'nested-prepared') {
    assertNotExpired(frame, path, context);
    const stack = await realizePreparedStack(payload.stack, context, `${path}.stack`);
    assertNotExpired(frame, path, context);
    return { kind: 'nested-stack', reference: payload.reference, stack };
  }
  return payload;
}

async function realizePreparedStack(
  prepared: PreparedStack,
  context: ProjectionContext,
  path: string,
): Promise<WorkerGpuFrameStackContractV1> {
  assertNotExpired(prepared.frame, `${path}.frame`, context);
  // Start every raw-pixel snapshot in the same synchronous turn. Each snapshot
  // helper must capture at invocation, so a slow source cannot delay capture of
  // a later source and mix two different host frames.
  const pendingBindings = prepared.bindings.map(async (binding, index) => ({
      layerId: binding.layerId,
      runtimeSourceKind: binding.runtimeSourceKind,
      sourceKind: binding.sourceKind,
      sourceId: binding.sourceId,
      renderLayer: binding.renderLayer,
      payload: await realizePayload(
        binding.payload,
        prepared.frame,
        context,
        `${path}.bindings[${index}].payload`,
      ),
    }));
  const settledBindings = await Promise.allSettled(pendingBindings);
  const failedBinding = settledBindings.find((result) => result.status === 'rejected');
  if (failedBinding?.status === 'rejected') throw failedBinding.reason;
  const bindings = settledBindings.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: prepared.occurrenceNamespace,
    dimensions: prepared.dimensions,
    frame: prepared.frame,
    execution: prepared.execution,
    bindings,
  };
}

export async function projectWorkerGpuFrameStack(
  input: WorkerGpuFrameStackProjectorInput,
): Promise<WorkerGpuFrameStackContractV1> {
  const context: ProjectionContext = {
    snapshotBitmap: input.snapshotBitmap ?? createWorkerSoftwareBitmapSnapshot,
    createdBitmaps: new Set<ImageBitmap>(),
    borrowedBitmapSources: new Set<object>(),
    clock: input.clock ?? Date.now,
    budget: {
      totalBindings: 0,
      totalPixels: 0,
      compositionAncestry: new Set<string>(),
    },
  };
  try {
    const prepared = prepareStack(input, context, '$', 0);
    const projected = await realizePreparedStack(prepared, context, '$');
    const admission: WorkerGpuFrameStackAdmission = {
      nowMs: assertNotExpired(prepared.frame, '$.frame', context),
      requestId: prepared.frame.requestId,
      targetId: prepared.frame.targetId,
      intent: prepared.frame.intent,
      graphVersion: prepared.frame.graphVersion,
    };
    try {
      assertWorkerGpuFrameStackContract(projected, admission);
    } catch {
      return fail('MD7_FRAME_STACK_PROJECTOR_CONTRACT_REJECTED', '$');
    }
    return projected;
  } catch (error) {
    closeCreatedBitmaps(context.createdBitmaps);
    throw error;
  }
}
