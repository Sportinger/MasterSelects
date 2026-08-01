import {
  MOTION_APPEARANCE_BLEND_MODES,
  type MotionLayerDefinition,
} from '../../types/motionDesign';
import {
  MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER,
  MOTION_ADJUSTMENT_MAX_JSON_NODES,
  MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH,
  MOTION_ADJUSTMENT_MAX_LAYERS,
  isMotionAdjustmentStableId,
} from '../motionDesign/adjustment/contractLimits';
import {
  assertMotionAdjustmentSourceIdentity,
  isMotionAdjustmentSourceKind,
  type MotionAdjustmentSourceKind,
} from '../motionDesign/adjustment/sourceContracts';
import {
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import { MOTION_MEDIA_MAX_RENDER_DIMENSION } from '../motionDesign/media/contracts';
import { assertMotionMediaSourceIdentity } from '../motionDesign/media/sourceReferencePlanner';
import { migrateMotionReplicatorContract } from '../motionDesign/replicator/contracts';
import { parseMotionModifierStackContract } from '../motionDesign/modifiers/contracts';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../engine/motion/MotionBuffers';
import type {
  WorkerGpuRenderIntent,
  WorkerGpuWebCodecsRenderLayer,
} from './workerGpuRuntimeCommands';

export const WORKER_GPU_FRAME_STACK_CONTRACT_VERSION =
  'worker-gpu-frame-stack/v1' as const;
export const WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH = 8;
export const WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS = MOTION_ADJUSTMENT_MAX_LAYERS;
export const WORKER_GPU_FRAME_STACK_MAX_TOTAL_PIXELS = 64 * 1024 * 1024;

export interface WorkerGpuFrameStackIdentity {
  readonly requestId: string;
  readonly targetId: string;
  readonly compositionId: string;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly intent: WorkerGpuRenderIntent;
  readonly submitByMs: number;
  readonly expireAfterMs: number;
  readonly graphVersion: number;
  readonly exact: true;
}

export interface WorkerGpuFrameStackDimensions {
  readonly width: number;
  readonly height: number;
}

export type WorkerGpuFrameStackExecution =
  | {
      readonly kind: 'frozen-adjustment';
      readonly plan: MotionAdjustmentWorkerGpuExecutionPlan;
    }
  | {
      readonly kind: 'ordered-sources';
      readonly bottomToTopLayerIds: readonly string[];
    };

export type WorkerGpuFrameStackPayload =
  | {
      readonly kind: 'webcodecs';
      readonly mediaTime: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'bitmap';
      readonly bitmap: ImageBitmap;
      readonly width: number;
      readonly height: number;
      readonly ownership: 'transferred-once';
    }
  | {
      readonly kind: 'solid';
      readonly color: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'motion';
      readonly definition: MotionLayerDefinition;
      readonly timelineTime: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'nested-stack';
      readonly reference: WorkerGpuNestedStackReference;
      readonly stack: WorkerGpuFrameStackContractV1;
    };

export type WorkerGpuFrameStackRuntimeSourceKind =
  | 'video'
  | 'image'
  | 'solid'
  | 'color'
  | 'text'
  | 'motion'
  | 'motionVideo'
  | 'motionImage'
  | 'motionNestedComposition'
  | 'nestedComposition';

export interface WorkerGpuNestedStackReference {
  readonly sourceId: string;
  readonly compositionId: string;
  readonly localTimelineTime: number;
  readonly occurrenceNamespace: string;
}

export interface WorkerGpuFrameStackSourceBinding {
  readonly layerId: string;
  readonly runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind;
  readonly sourceKind: MotionAdjustmentSourceKind;
  readonly sourceId: string;
  readonly renderLayer: WorkerGpuWebCodecsRenderLayer;
  readonly payload: WorkerGpuFrameStackPayload;
}

/**
 * An atomic exact one-shot Worker GPU stack. Every nested occurrence owns the
 * same complete contract so source order and Adjustment semantics never fall
 * back to an implicit or software-only model.
 */
export interface WorkerGpuFrameStackContractV1 {
  readonly contractVersion: typeof WORKER_GPU_FRAME_STACK_CONTRACT_VERSION;
  readonly frameMode: 'exact-one-shot';
  readonly occurrenceNamespace: string;
  readonly dimensions: WorkerGpuFrameStackDimensions;
  readonly frame: WorkerGpuFrameStackIdentity;
  readonly execution: WorkerGpuFrameStackExecution;
  readonly bindings: readonly WorkerGpuFrameStackSourceBinding[];
}

export type WorkerGpuFrameStackDiagnosticCode =
  | 'MD7_FRAME_STACK_INVALID_CONTRACT'
  | 'MD7_FRAME_STACK_UNSUPPORTED_VERSION'
  | 'MD7_FRAME_STACK_EXACT_ONE_SHOT_REQUIRED'
  | 'MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH'
  | 'MD7_FRAME_STACK_FRAME_EXPIRED'
  | 'MD7_FRAME_STACK_ADMISSION_MISMATCH'
  | 'MD7_FRAME_STACK_INVALID_LAYER_ID'
  | 'MD7_FRAME_STACK_DUPLICATE_LAYER_ID'
  | 'MD7_FRAME_STACK_INVALID_SOURCE_KIND'
  | 'MD7_FRAME_STACK_INVALID_RUNTIME_SOURCE_KIND'
  | 'MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH'
  | 'MD7_FRAME_STACK_INVALID_SOURCE_ID'
  | 'MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH'
  | 'MD7_FRAME_STACK_INVALID_RENDER_LAYER'
  | 'MD7_FRAME_STACK_RENDER_LAYER_ID_MISMATCH'
  | 'MD7_FRAME_STACK_INVALID_PAYLOAD'
  | 'MD7_FRAME_STACK_SOURCE_KIND_PAYLOAD_MISMATCH'
  | 'MD7_FRAME_STACK_BITMAP_OWNERSHIP_INVALID'
  | 'MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP'
  | 'MD7_FRAME_STACK_PLAN_INVALID'
  | 'MD7_FRAME_STACK_PLAN_BINDING_MISMATCH'
  | 'MD7_FRAME_STACK_NESTED_PLAN_REQUIRED'
  | 'MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH'
  | 'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH'
  | 'MD7_FRAME_STACK_DUPLICATE_OCCURRENCE_NAMESPACE'
  | 'MD7_FRAME_STACK_NESTING_DEPTH_EXCEEDED'
  | 'MD7_FRAME_STACK_COMPOSITION_CYCLE'
  | 'MD7_FRAME_STACK_DIMENSION_LIMIT'
  | 'MD7_FRAME_STACK_BINDING_BUDGET_EXCEEDED'
  | 'MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED'
  | 'MD7_FRAME_STACK_NON_CLONEABLE_DATA';

export interface WorkerGpuFrameStackDiagnostic {
  readonly code: WorkerGpuFrameStackDiagnosticCode;
  readonly message: string;
  readonly path: string;
}

export type WorkerGpuFrameStackValidation =
  | { readonly ok: true; readonly contract: WorkerGpuFrameStackContractV1 }
  | ({ readonly ok: false } & WorkerGpuFrameStackDiagnostic);

const DIAGNOSTIC_MESSAGES = {
  MD7_FRAME_STACK_INVALID_CONTRACT: 'The Worker GPU frame-stack contract is invalid',
  MD7_FRAME_STACK_UNSUPPORTED_VERSION: 'The Worker GPU frame-stack contract version is unsupported',
  MD7_FRAME_STACK_EXACT_ONE_SHOT_REQUIRED: 'The Worker GPU frame stack must be exact and one-shot',
  MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH: 'The Worker GPU frame-stack identity is invalid or mismatched',
  MD7_FRAME_STACK_FRAME_EXPIRED: 'The Worker GPU frame stack has expired',
  MD7_FRAME_STACK_ADMISSION_MISMATCH: 'The Worker GPU frame stack does not match its admission request',
  MD7_FRAME_STACK_INVALID_LAYER_ID: 'A Worker GPU frame-stack layer id is invalid',
  MD7_FRAME_STACK_DUPLICATE_LAYER_ID: 'A Worker GPU frame-stack layer id is duplicated',
  MD7_FRAME_STACK_INVALID_SOURCE_KIND: 'A Worker GPU frame-stack source kind is invalid',
  MD7_FRAME_STACK_INVALID_RUNTIME_SOURCE_KIND: 'A Worker GPU frame-stack runtime source kind is invalid',
  MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH: 'A Worker GPU frame-stack runtime source kind does not match its payload',
  MD7_FRAME_STACK_INVALID_SOURCE_ID: 'A Worker GPU frame-stack source id is invalid',
  MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH: 'A Worker GPU frame-stack source id does not match its payload subtype',
  MD7_FRAME_STACK_INVALID_RENDER_LAYER: 'A Worker GPU frame-stack render layer is invalid',
  MD7_FRAME_STACK_RENDER_LAYER_ID_MISMATCH: 'A Worker GPU frame-stack render layer identity does not match its binding',
  MD7_FRAME_STACK_INVALID_PAYLOAD: 'A Worker GPU frame-stack source payload is invalid',
  MD7_FRAME_STACK_SOURCE_KIND_PAYLOAD_MISMATCH: 'A Worker GPU frame-stack source kind cannot use this payload',
  MD7_FRAME_STACK_BITMAP_OWNERSHIP_INVALID: 'A Worker GPU frame-stack bitmap must transfer ownership exactly once',
  MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP: 'A Worker GPU frame-stack bitmap cannot have more than one lifecycle owner',
  MD7_FRAME_STACK_PLAN_INVALID: 'The Worker GPU frame-stack frozen Adjustment plan is invalid',
  MD7_FRAME_STACK_PLAN_BINDING_MISMATCH: 'The Worker GPU frame-stack execution is not a bijection over its bindings',
  MD7_FRAME_STACK_NESTED_PLAN_REQUIRED: 'A nested frozen Adjustment stack requires its exact inner plan',
  MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH: 'A frozen Adjustment plan does not own the stack occurrence namespace',
  MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH: 'A nested Worker GPU frame stack does not match its parent reference',
  MD7_FRAME_STACK_DUPLICATE_OCCURRENCE_NAMESPACE: 'A Worker GPU frame-stack occurrence namespace is duplicated',
  MD7_FRAME_STACK_NESTING_DEPTH_EXCEEDED: 'Worker GPU frame-stack nesting exceeds the hard depth limit',
  MD7_FRAME_STACK_COMPOSITION_CYCLE: 'Worker GPU frame-stack compositions cannot contain an ancestry cycle',
  MD7_FRAME_STACK_DIMENSION_LIMIT: 'Worker GPU frame-stack dimensions are invalid or exceed the hard limit',
  MD7_FRAME_STACK_BINDING_BUDGET_EXCEEDED: 'Worker GPU frame-stack bindings exceed the total hard budget',
  MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED: 'Worker GPU frame-stack pixels exceed the total hard budget',
  MD7_FRAME_STACK_NON_CLONEABLE_DATA: 'Worker GPU frame-stack plain data is not structured-clone safe',
} as const satisfies Record<WorkerGpuFrameStackDiagnosticCode, string>;

const RENDER_LAYER_KEYS = [
  'id',
  'name',
  'sourceClipId',
  'visible',
  'opacity',
  'blendMode',
  'position',
  'scale',
  'rotation',
  'videoRotation',
  'sourceRect',
  'effects',
  'colorCorrection',
  'maskFeather',
  'maskFeatherQuality',
  'maskInvert',
  'maskClipId',
  'transitionRender',
] as const;

type UnknownRecord = Record<string, unknown>;

interface ValidationBudget {
  totalBindings: number;
  totalPixels: number;
  totalCloneNodes: number;
  totalStringUnits: number;
  readonly occurrenceNamespaces: Set<string>;
  readonly compositionAncestry: Set<string>;
  readonly ownedBitmaps: WeakSet<object>;
}

export interface WorkerGpuFrameStackAdmission {
  readonly nowMs: number;
  readonly requestId: string;
  readonly targetId: string;
  readonly intent: WorkerGpuRenderIntent;
  readonly graphVersion: number;
}

const WORKER_GPU_FRAME_STACK_MAX_TOTAL_STRING_UNITS = 1024 * 1024;

export class WorkerGpuFrameStackContractError extends Error {
  readonly code: WorkerGpuFrameStackDiagnosticCode;
  readonly path: string;

  constructor(code: WorkerGpuFrameStackDiagnosticCode, path: string) {
    super(`[${code}] ${DIAGNOSTIC_MESSAGES[code]} at ${path}`);
    this.name = 'WorkerGpuFrameStackContractError';
    this.code = code;
    this.path = path;
  }
}

function fail(code: WorkerGpuFrameStackDiagnosticCode, path: string): never {
  throw new WorkerGpuFrameStackContractError(code, path);
}

function requirePlainRecord(
  value: unknown,
  path: string,
  code: WorkerGpuFrameStackDiagnosticCode,
): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(code, path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(code, path);
  }
  return value as UnknownRecord;
}

function dataValue(
  record: UnknownRecord,
  key: string,
  path: string,
  code: WorkerGpuFrameStackDiagnosticCode = 'MD7_FRAME_STACK_INVALID_CONTRACT',
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
    return fail(code, `${path}.${key}`);
  }
  return descriptor.value;
}

function optionalDataValue(record: UnknownRecord, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return dataValue(record, key, path);
}

function assertExactKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  code: WorkerGpuFrameStackDiagnosticCode,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail(code, `${path}.${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', `${path}.${key}`);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isImageBitmapValue(value: unknown): value is ImageBitmap {
  const ImageBitmapConstructor = (globalThis as typeof globalThis & {
    ImageBitmap?: typeof ImageBitmap;
  }).ImageBitmap;
  return typeof ImageBitmapConstructor === 'function' && value instanceof ImageBitmapConstructor;
}

function assertCloneablePlainData(
  value: unknown,
  path: string,
  allowImageBitmap: boolean,
  budget: ValidationBudget,
  ancestors = new WeakSet<object>(),
  depth = 1,
): void {
  budget.totalCloneNodes += 1;
  if (budget.totalCloneNodes > MOTION_ADJUSTMENT_MAX_JSON_NODES) {
    fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
  }
  if (
    value === undefined
    || value === null
    || typeof value === 'boolean'
  ) return;
  if (typeof value === 'string') {
    if (value.length > MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH) {
      fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
    }
    budget.totalStringUnits += value.length;
    if (budget.totalStringUnits > WORKER_GPU_FRAME_STACK_MAX_TOTAL_STRING_UNITS) {
      fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
    return;
  }
  if (typeof value !== 'object') fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
  if (allowImageBitmap && isImageBitmapValue(value)) return;
  if (depth > 64 || ancestors.has(value)) {
    fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) {
    fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
  }
  if (isArray) {
    const array = value as unknown[];
    const dataKeys = keys.filter((key) => key !== 'length');
    if (dataKeys.length !== array.length || dataKeys.some((key, index) => key !== String(index))) {
      fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', path);
    }
  }

  ancestors.add(value);
  for (const key of keys) {
    if (isArray && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      fail('MD7_FRAME_STACK_NON_CLONEABLE_DATA', `${path}.${String(key)}`);
    }
    assertCloneablePlainData(
      descriptor.value,
      `${path}.${String(key)}`,
      allowImageBitmap,
      budget,
      ancestors,
      depth + 1,
    );
  }
  ancestors.delete(value);
}

function assertFiniteVector(
  value: unknown,
  keys: readonly string[],
  path: string,
  code: WorkerGpuFrameStackDiagnosticCode,
): void {
  const record = requirePlainRecord(value, path, code);
  for (const key of keys) {
    if (!isFiniteNumber(dataValue(record, key, path, code))) fail(code, `${path}.${key}`);
  }
}

function assertRenderLayer(
  value: unknown,
  layerId: string,
  path: string,
  budget: ValidationBudget,
): void {
  const code = 'MD7_FRAME_STACK_INVALID_RENDER_LAYER';
  const record = requirePlainRecord(value, path, code);
  assertExactKeys(record, RENDER_LAYER_KEYS, path, code);
  assertCloneablePlainData(record, path, false, budget);

  const id = dataValue(record, 'id', path, code);
  const name = dataValue(record, 'name', path, code);
  const sourceClipId = optionalDataValue(record, 'sourceClipId', path);
  if (!isMotionAdjustmentStableId(id) || typeof name !== 'string') fail(code, path);
  if (sourceClipId !== undefined && !isMotionAdjustmentStableId(sourceClipId)) {
    fail(code, `${path}.sourceClipId`);
  }
  if (typeof dataValue(record, 'visible', path, code) !== 'boolean') {
    fail(code, `${path}.visible`);
  }
  const opacity = dataValue(record, 'opacity', path, code);
  if (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1) {
    fail(code, `${path}.opacity`);
  }
  const blendMode = dataValue(record, 'blendMode', path, code);
  if (typeof blendMode !== 'string' || blendMode.length === 0) {
    fail(code, `${path}.blendMode`);
  }
  assertFiniteVector(dataValue(record, 'position', path, code), ['x', 'y', 'z'], `${path}.position`, code);
  const scale = requirePlainRecord(dataValue(record, 'scale', path, code), `${path}.scale`, code);
  if (
    !isFiniteNumber(dataValue(scale, 'x', `${path}.scale`, code))
    || !isFiniteNumber(dataValue(scale, 'y', `${path}.scale`, code))
  ) {
    fail(code, `${path}.scale`);
  }
  const scaleZ = optionalDataValue(scale, 'z', `${path}.scale`);
  if (scaleZ !== undefined && !isFiniteNumber(scaleZ)) fail(code, `${path}.scale.z`);
  const rotation = dataValue(record, 'rotation', path, code);
  if (!isFiniteNumber(rotation)) {
    assertFiniteVector(rotation, ['x', 'y', 'z'], `${path}.rotation`, code);
  }
  const videoRotation = optionalDataValue(record, 'videoRotation', path);
  if (
    videoRotation !== undefined
    && videoRotation !== 0
    && videoRotation !== 90
    && videoRotation !== 180
    && videoRotation !== 270
  ) {
    fail(code, `${path}.videoRotation`);
  }
  const effects = dataValue(record, 'effects', path, code);
  if (!Array.isArray(effects) || effects.length > MOTION_ADJUSTMENT_MAX_EFFECTS_PER_LAYER) {
    fail(code, `${path}.effects`);
  }

  if ((sourceClipId ?? id) !== layerId) {
    fail('MD7_FRAME_STACK_RENDER_LAYER_ID_MISMATCH', path);
  }
}

function assertDimensions(
  value: unknown,
  path: string,
  budget: ValidationBudget,
): WorkerGpuFrameStackDimensions {
  const record = requirePlainRecord(value, path, 'MD7_FRAME_STACK_DIMENSION_LIMIT');
  assertExactKeys(record, ['width', 'height'], path, 'MD7_FRAME_STACK_DIMENSION_LIMIT');
  const width = dataValue(record, 'width', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT');
  const height = dataValue(record, 'height', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT');
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || (width as number) < 1
    || (height as number) < 1
    || (width as number) > MOTION_MEDIA_MAX_RENDER_DIMENSION
    || (height as number) > MOTION_MEDIA_MAX_RENDER_DIMENSION
  ) {
    fail('MD7_FRAME_STACK_DIMENSION_LIMIT', path);
  }
  budget.totalPixels += (width as number) * (height as number);
  if (budget.totalPixels > WORKER_GPU_FRAME_STACK_MAX_TOTAL_PIXELS) {
    fail('MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED', path);
  }
  return { width: width as number, height: height as number };
}

function chargePixels(
  width: number,
  height: number,
  multiplier: number,
  path: string,
  budget: ValidationBudget,
): void {
  budget.totalPixels += width * height * multiplier;
  if (!Number.isSafeInteger(budget.totalPixels)
    || budget.totalPixels > WORKER_GPU_FRAME_STACK_MAX_TOTAL_PIXELS) {
    fail('MD7_FRAME_STACK_PIXEL_BUDGET_EXCEEDED', path);
  }
}

function isWorkerGpuRenderIntent(value: unknown): value is WorkerGpuRenderIntent {
  return value === 'playback'
    || value === 'scrub'
    || value === 'seek'
    || value === 'preview'
    || value === 'export'
    || value === 'proof';
}

function assertAdmission(admission: WorkerGpuFrameStackAdmission): void {
  if (
    !isFiniteNumber(admission.nowMs)
    || !isMotionAdjustmentStableId(admission.requestId)
    || !isMotionAdjustmentStableId(admission.targetId)
    || !isWorkerGpuRenderIntent(admission.intent)
    || !isSafeNonNegativeInteger(admission.graphVersion)
  ) {
    fail('MD7_FRAME_STACK_ADMISSION_MISMATCH', '$');
  }
}

export function createWorkerGpuNestedOccurrenceNamespace(
  parentOccurrenceNamespace: string,
  parentLayerId: string,
): string {
  return `${parentOccurrenceNamespace}:nested:${parentLayerId}`;
}

function assertFrameIdentity(
  value: unknown,
  path: string,
  parentFrame: WorkerGpuFrameStackIdentity | null,
  admission: WorkerGpuFrameStackAdmission,
): WorkerGpuFrameStackIdentity {
  const code = 'MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH';
  const record = requirePlainRecord(value, path, code);
  assertExactKeys(record, [
    'requestId',
    'targetId',
    'compositionId',
    'timelineTime',
    'frameIndex',
    'intent',
    'submitByMs',
    'expireAfterMs',
    'graphVersion',
    'exact',
  ], path, code);
  const requestId = dataValue(record, 'requestId', path, code);
  const targetId = dataValue(record, 'targetId', path, code);
  const compositionId = dataValue(record, 'compositionId', path, code);
  const timelineTime = dataValue(record, 'timelineTime', path, code);
  const frameIndex = dataValue(record, 'frameIndex', path, code);
  const intent = dataValue(record, 'intent', path, code);
  const submitByMs = dataValue(record, 'submitByMs', path, code);
  const expireAfterMs = dataValue(record, 'expireAfterMs', path, code);
  const graphVersion = dataValue(record, 'graphVersion', path, code);
  const exact = dataValue(record, 'exact', path, code);
  if (
    !isMotionAdjustmentStableId(requestId)
    || !isMotionAdjustmentStableId(targetId)
    || !isMotionAdjustmentStableId(compositionId)
    || !isFiniteNumber(timelineTime)
    || !isSafeNonNegativeInteger(frameIndex)
    || !isWorkerGpuRenderIntent(intent)
    || !isFiniteNumber(submitByMs)
    || !isFiniteNumber(expireAfterMs)
    || expireAfterMs <= submitByMs
    || !isSafeNonNegativeInteger(graphVersion)
    || exact !== true
  ) {
    fail(code, path);
  }
  const frame: WorkerGpuFrameStackIdentity = {
    requestId,
    targetId,
    compositionId,
    timelineTime,
    frameIndex,
    intent,
    submitByMs,
    expireAfterMs,
    graphVersion,
    exact: true,
  };
  if (admission.nowMs >= frame.expireAfterMs) {
    fail('MD7_FRAME_STACK_FRAME_EXPIRED', `${path}.expireAfterMs`);
  }
  if (
    parentFrame
    && (
      frame.requestId !== parentFrame.requestId
      || frame.targetId !== parentFrame.targetId
      || frame.frameIndex !== parentFrame.frameIndex
      || frame.intent !== parentFrame.intent
      || frame.submitByMs !== parentFrame.submitByMs
      || frame.expireAfterMs !== parentFrame.expireAfterMs
      || frame.graphVersion !== parentFrame.graphVersion
    )
  ) {
    fail(code, path);
  }
  if (
    !parentFrame
    && (
      frame.requestId !== admission.requestId
      || frame.targetId !== admission.targetId
      || frame.intent !== admission.intent
      || frame.graphVersion !== admission.graphVersion
    )
  ) {
    fail('MD7_FRAME_STACK_ADMISSION_MISMATCH', path);
  }
  return frame;
}

function requireFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (!isFiniteNumber(value) || value < minimum || value > maximum) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', path);
  }
  return value;
}

function assertMotionVector(value: unknown, path: string): void {
  const vector = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  assertExactKeys(vector, ['x', 'y'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  requireFiniteRange(dataValue(vector, 'x', path), -1_000_000, 1_000_000, `${path}.x`);
  requireFiniteRange(dataValue(vector, 'y', path), -1_000_000, 1_000_000, `${path}.y`);
}

function assertMotionColor(value: unknown, path: string): void {
  const color = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  assertExactKeys(color, ['r', 'g', 'b', 'a'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  for (const component of ['r', 'g', 'b', 'a'] as const) {
    requireFiniteRange(dataValue(color, component, path), 0, 1, `${path}.${component}`);
  }
}

function assertAppearanceBase(item: UnknownRecord, path: string): void {
  const id = dataValue(item, 'id', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  const name = dataValue(item, 'name', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  if (!isMotionAdjustmentStableId(id) || typeof name !== 'string'
    || name.length > MOTION_ADJUSTMENT_MAX_JSON_STRING_LENGTH) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', path);
  }
  if (typeof dataValue(item, 'visible', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD') !== 'boolean') {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.visible`);
  }
  requireFiniteRange(
    dataValue(item, 'opacity', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
    0,
    1,
    `${path}.opacity`,
  );
  const blendMode = optionalDataValue(item, 'blendMode', path);
  if (blendMode !== undefined && !MOTION_APPEARANCE_BLEND_MODES.includes(
    blendMode as (typeof MOTION_APPEARANCE_BLEND_MODES)[number],
  )) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.blendMode`);
  }
}

function assertGradientStops(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > MOTION_MAX_GRADIENT_STOPS) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', path);
  }
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const stopPath = `${path}[${index}]`;
    const stop = requirePlainRecord(entry, stopPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    assertExactKeys(stop, ['id', 'offset', 'color'], stopPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    const id = dataValue(stop, 'id', stopPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    if (!isMotionAdjustmentStableId(id) || ids.has(id)) {
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${stopPath}.id`);
    }
    ids.add(id);
    requireFiniteRange(
      dataValue(stop, 'offset', stopPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
      0,
      1,
      `${stopPath}.offset`,
    );
    assertMotionColor(
      dataValue(stop, 'color', stopPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
      `${stopPath}.color`,
    );
  });
}

function assertMotionAppearance(value: unknown, path: string): void {
  const appearance = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  assertExactKeys(appearance, ['version', 'items', 'selectedItemId'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  if (dataValue(appearance, 'version', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD') !== 1) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.version`);
  }
  const items = dataValue(appearance, 'items', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  if (!Array.isArray(items) || items.length > MOTION_MAX_APPEARANCES) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.items`);
  }
  const ids = new Set<string>();
  items.forEach((entry, index) => {
    const itemPath = `${path}.items[${index}]`;
    const item = requirePlainRecord(entry, itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    const kind = dataValue(item, 'kind', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    const baseKeys = ['id', 'kind', 'name', 'visible', 'opacity', 'blendMode'] as const;
    switch (kind) {
      case 'color-fill':
        assertExactKeys(item, [...baseKeys, 'color'], itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
        assertMotionColor(
          dataValue(item, 'color', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.color`,
        );
        break;
      case 'stroke': {
        assertExactKeys(item, [...baseKeys, 'color', 'width', 'alignment'], itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
        assertMotionColor(
          dataValue(item, 'color', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.color`,
        );
        requireFiniteRange(
          dataValue(item, 'width', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          0,
          MOTION_MEDIA_MAX_RENDER_DIMENSION,
          `${itemPath}.width`,
        );
        const alignment = dataValue(
          item,
          'alignment',
          itemPath,
          'MD7_FRAME_STACK_INVALID_PAYLOAD',
        );
        if (alignment !== 'center' && alignment !== 'inside' && alignment !== 'outside') {
          fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${itemPath}.alignment`);
        }
        break;
      }
      case 'linear-gradient':
        assertExactKeys(item, [...baseKeys, 'stops', 'start', 'end'], itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
        assertGradientStops(
          dataValue(item, 'stops', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.stops`,
        );
        assertMotionVector(
          dataValue(item, 'start', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.start`,
        );
        assertMotionVector(
          dataValue(item, 'end', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.end`,
        );
        break;
      case 'radial-gradient':
        assertExactKeys(item, [...baseKeys, 'stops', 'center', 'radius'], itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
        assertGradientStops(
          dataValue(item, 'stops', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.stops`,
        );
        assertMotionVector(
          dataValue(item, 'center', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          `${itemPath}.center`,
        );
        requireFiniteRange(
          dataValue(item, 'radius', itemPath, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
          Number.MIN_VALUE,
          1_000_000,
          `${itemPath}.radius`,
        );
        break;
      default:
        // Texture fills are deliberately excluded until their GPU media
        // resource path is represented in this contract.
        fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${itemPath}.kind`);
    }
    assertAppearanceBase(item, itemPath);
    const id = dataValue(item, 'id', itemPath) as string;
    if (ids.has(id)) fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${itemPath}.id`);
    ids.add(id);
  });
  const selectedItemId = optionalDataValue(appearance, 'selectedItemId', path);
  if (selectedItemId !== undefined
    && (!isMotionAdjustmentStableId(selectedItemId) || !ids.has(selectedItemId))) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.selectedItemId`);
  }
}

function assertMotionDefinition(
  value: unknown,
  path: string,
  budget: ValidationBudget,
): void {
  const definition = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  assertExactKeys(definition, [
    'version',
    'kind',
    'shape',
    'appearance',
    'replicator',
    'modifierStack',
    'ui',
  ], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  assertCloneablePlainData(definition, path, false, budget);
  if (dataValue(definition, 'version', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD') !== 1) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.version`);
  }
  const kind = dataValue(definition, 'kind', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  // MotionRenderer currently produces a GPU source only for concrete shapes.
  // Nulls, groups, and adjustment definitions are control layers and must not
  // enter the source-materialization path as if they had pixels.
  if (kind !== 'shape') {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.kind`);
  }
  const shape = requirePlainRecord(
    dataValue(definition, 'shape', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
    `${path}.shape`,
    'MD7_FRAME_STACK_INVALID_PAYLOAD',
  );
  assertExactKeys(shape, [
    'primitive',
    'size',
    'cornerRadius',
    'polygon',
    'star',
  ], `${path}.shape`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  const primitive = dataValue(shape, 'primitive', `${path}.shape`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  if (
    primitive !== 'rectangle'
    && primitive !== 'ellipse'
    && primitive !== 'polygon'
    && primitive !== 'star'
  ) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.shape.primitive`);
  }
  const size = requirePlainRecord(
    dataValue(shape, 'size', `${path}.shape`, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
    `${path}.shape.size`,
    'MD7_FRAME_STACK_INVALID_PAYLOAD',
  );
  const width = dataValue(size, 'w', `${path}.shape.size`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  const height = dataValue(size, 'h', `${path}.shape.size`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  if (
    !isFiniteNumber(width)
    || !isFiniteNumber(height)
    || width <= 0
    || height <= 0
    || width > MOTION_MEDIA_MAX_RENDER_DIMENSION
    || height > MOTION_MEDIA_MAX_RENDER_DIMENSION
  ) {
    fail('MD7_FRAME_STACK_DIMENSION_LIMIT', `${path}.shape.size`);
  }
  const cornerRadius = optionalDataValue(shape, 'cornerRadius', `${path}.shape`);
  if (cornerRadius !== undefined) {
    requireFiniteRange(cornerRadius, 0, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.cornerRadius`);
  }
  const polygon = optionalDataValue(shape, 'polygon', `${path}.shape`);
  if (primitive === 'polygon') {
    const polygonRecord = requirePlainRecord(polygon, `${path}.shape.polygon`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    assertExactKeys(polygonRecord, ['points', 'radius', 'cornerRadius'], `${path}.shape.polygon`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    requireFiniteRange(dataValue(polygonRecord, 'points', `${path}.shape.polygon`), 3, 32, `${path}.shape.polygon.points`);
    requireFiniteRange(dataValue(polygonRecord, 'radius', `${path}.shape.polygon`), Number.MIN_VALUE, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.polygon.radius`);
    requireFiniteRange(dataValue(polygonRecord, 'cornerRadius', `${path}.shape.polygon`), 0, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.polygon.cornerRadius`);
  } else if (polygon !== undefined) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.shape.polygon`);
  }
  const star = optionalDataValue(shape, 'star', `${path}.shape`);
  if (primitive === 'star') {
    const starRecord = requirePlainRecord(star, `${path}.shape.star`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    assertExactKeys(starRecord, ['points', 'outerRadius', 'innerRadius', 'cornerRadius'], `${path}.shape.star`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    requireFiniteRange(dataValue(starRecord, 'points', `${path}.shape.star`), 3, 32, `${path}.shape.star.points`);
    requireFiniteRange(dataValue(starRecord, 'outerRadius', `${path}.shape.star`), Number.MIN_VALUE, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.star.outerRadius`);
    requireFiniteRange(dataValue(starRecord, 'innerRadius', `${path}.shape.star`), Number.MIN_VALUE, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.star.innerRadius`);
    requireFiniteRange(dataValue(starRecord, 'cornerRadius', `${path}.shape.star`), 0, MOTION_MEDIA_MAX_RENDER_DIMENSION, `${path}.shape.star.cornerRadius`);
  } else if (star !== undefined) {
    fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.shape.star`);
  }

  const appearance = optionalDataValue(definition, 'appearance', path);
  if (appearance !== undefined) assertMotionAppearance(appearance, `${path}.appearance`);

  const replicator = optionalDataValue(definition, 'replicator', path);
  if (replicator !== undefined) {
    try {
      const record = requirePlainRecord(replicator, `${path}.replicator`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      if (record.contract !== 'masterselects.motion-replicator' || record.version !== 2) {
        fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.replicator`);
      }
      migrateMotionReplicatorContract(replicator);
    } catch {
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.replicator`);
    }
  }
  const modifierStack = optionalDataValue(definition, 'modifierStack', path);
  if (modifierStack !== undefined) {
    try {
      parseMotionModifierStackContract(modifierStack);
    } catch {
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.modifierStack`);
    }
  }
  const ui = optionalDataValue(definition, 'ui', path);
  if (ui !== undefined) {
    const uiRecord = requirePlainRecord(ui, `${path}.ui`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    assertExactKeys(uiRecord, ['labelColor', 'locked', 'pinnedProperties', 'propertiesSearch'], `${path}.ui`, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
    const locked = optionalDataValue(uiRecord, 'locked', `${path}.ui`);
    if (locked !== undefined && typeof locked !== 'boolean') {
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.ui.locked`);
    }
    const pinned = optionalDataValue(uiRecord, 'pinnedProperties', `${path}.ui`);
    if (pinned !== undefined && (!Array.isArray(pinned) || pinned.length > 64
      || pinned.some((entry) => typeof entry !== 'string'))) {
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.ui.pinnedProperties`);
    }
    for (const key of ['labelColor', 'propertiesSearch'] as const) {
      const entry = optionalDataValue(uiRecord, key, `${path}.ui`);
      if (entry !== undefined && typeof entry !== 'string') {
        fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.ui.${key}`);
      }
    }
  }
}

function payloadSupportsSourceKind(
  payloadKind: WorkerGpuFrameStackPayload['kind'],
  runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind,
): boolean {
  return (runtimeSourceKind === 'video' && (payloadKind === 'webcodecs' || payloadKind === 'bitmap'))
    || (runtimeSourceKind === 'image' && payloadKind === 'bitmap')
    || ((runtimeSourceKind === 'solid' || runtimeSourceKind === 'color') && payloadKind === 'solid')
    || (runtimeSourceKind === 'text' && payloadKind === 'bitmap')
    || (runtimeSourceKind === 'motion' && payloadKind === 'motion')
    || (runtimeSourceKind === 'motionVideo' && payloadKind === 'webcodecs')
    || (runtimeSourceKind === 'motionImage' && payloadKind === 'bitmap')
    || (runtimeSourceKind === 'motionNestedComposition' && payloadKind === 'nested-stack')
    || (runtimeSourceKind === 'nestedComposition' && payloadKind === 'nested-stack');
}

function isRuntimeSourceKind(value: unknown): value is WorkerGpuFrameStackRuntimeSourceKind {
  return value === 'video'
    || value === 'image'
    || value === 'solid'
    || value === 'color'
    || value === 'text'
    || value === 'motion'
    || value === 'motionVideo'
    || value === 'motionImage'
    || value === 'motionNestedComposition'
    || value === 'nestedComposition';
}

function sourceKindForRuntimeKind(
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

function assertPayloadSourceId(
  payloadKind: WorkerGpuFrameStackPayload['kind'],
  sourceKind: MotionAdjustmentSourceKind,
  sourceId: string,
  path: string,
): void {
  if (sourceKind !== 'motion-media') return;
  let expectedKind: 'image' | 'video' | 'nested-composition';
  switch (payloadKind) {
    case 'webcodecs':
      expectedKind = 'video';
      break;
    case 'bitmap':
    case 'motion':
      expectedKind = 'image';
      break;
    case 'nested-stack':
      expectedKind = 'nested-composition';
      break;
    case 'solid':
      return fail('MD7_FRAME_STACK_SOURCE_KIND_PAYLOAD_MISMATCH', path);
  }
  try {
    assertMotionMediaSourceIdentity(sourceId, expectedKind);
  } catch {
    fail('MD7_FRAME_STACK_SOURCE_ID_PAYLOAD_MISMATCH', path);
  }
}

function assertPayload(
  value: unknown,
  runtimeSourceKind: WorkerGpuFrameStackRuntimeSourceKind,
  sourceKind: MotionAdjustmentSourceKind,
  sourceId: string,
  containingFrame: WorkerGpuFrameStackIdentity,
  containingOccurrenceNamespace: string,
  layerId: string,
  path: string,
  depth: number,
  budget: ValidationBudget,
  admission: WorkerGpuFrameStackAdmission,
): void {
  const payload = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  const kind = dataValue(payload, 'kind', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
  switch (kind) {
    case 'webcodecs':
      assertExactKeys(payload, ['kind', 'mediaTime', 'width', 'height'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      if (!isFiniteNumber(dataValue(payload, 'mediaTime', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'))) {
        fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.mediaTime`);
      }
      assertDimensions({
        width: dataValue(payload, 'width', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
        height: dataValue(payload, 'height', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
      }, path, budget);
      break;
    case 'bitmap': {
      assertExactKeys(payload, ['kind', 'bitmap', 'width', 'height', 'ownership'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      if (dataValue(payload, 'ownership', path, 'MD7_FRAME_STACK_BITMAP_OWNERSHIP_INVALID') !== 'transferred-once') {
        fail('MD7_FRAME_STACK_BITMAP_OWNERSHIP_INVALID', `${path}.ownership`);
      }
      const bitmap = dataValue(payload, 'bitmap', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      if (!isImageBitmapValue(bitmap)) fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.bitmap`);
      if (budget.ownedBitmaps.has(bitmap as object)) {
        fail('MD7_FRAME_STACK_DUPLICATE_BITMAP_OWNERSHIP', `${path}.bitmap`);
      }
      budget.ownedBitmaps.add(bitmap as object);
      const dimensions = assertDimensions({
        width: dataValue(payload, 'width', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
        height: dataValue(payload, 'height', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
      }, path, budget);
      if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) {
        fail('MD7_FRAME_STACK_DIMENSION_LIMIT', path);
      }
      break;
    }
    case 'solid':
      assertExactKeys(payload, ['kind', 'color', 'width', 'height'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      {
        const color = dataValue(payload, 'color', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
        // The Worker GPU path intentionally has no DOM/CSS color parser. Keep
        // transport deterministic and fail closed instead of silently painting
        // an unsupported CSS color as black.
        if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(color)) {
          fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.color`);
        }
      }
      assertDimensions({
        width: dataValue(payload, 'width', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
        height: dataValue(payload, 'height', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
      }, path, budget);
      break;
    case 'motion':
      assertExactKeys(payload, ['kind', 'definition', 'timelineTime', 'width', 'height'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      if (dataValue(payload, 'timelineTime', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD') !== containingFrame.timelineTime) {
        fail('MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH', `${path}.timelineTime`);
      }
      assertMotionDefinition(
        dataValue(payload, 'definition', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
        `${path}.definition`,
        budget,
      );
      assertDimensions({
        width: dataValue(payload, 'width', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
        height: dataValue(payload, 'height', path, 'MD7_FRAME_STACK_DIMENSION_LIMIT'),
      }, path, budget);
      break;
    case 'nested-stack': {
      assertExactKeys(payload, ['kind', 'reference', 'stack'], path, 'MD7_FRAME_STACK_INVALID_PAYLOAD');
      const referencePath = `${path}.reference`;
      const reference = requirePlainRecord(
        dataValue(payload, 'reference', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
        referencePath,
        'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH',
      );
      assertExactKeys(
        reference,
        ['sourceId', 'compositionId', 'localTimelineTime', 'occurrenceNamespace'],
        referencePath,
        'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH',
      );
      const referenceSourceId = dataValue(reference, 'sourceId', referencePath, 'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH');
      const referenceCompositionId = dataValue(reference, 'compositionId', referencePath, 'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH');
      const referenceTimelineTime = dataValue(reference, 'localTimelineTime', referencePath, 'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH');
      const referenceNamespace = dataValue(reference, 'occurrenceNamespace', referencePath, 'MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH');
      const expectedNamespace = createWorkerGpuNestedOccurrenceNamespace(
        containingOccurrenceNamespace,
        layerId,
      );
      if (
        referenceSourceId !== sourceId
        || !isMotionAdjustmentStableId(referenceCompositionId)
        || !isFiniteNumber(referenceTimelineTime)
        || referenceNamespace !== expectedNamespace
        || !isMotionAdjustmentStableId(referenceNamespace)
        || (sourceKind === 'nested-composition'
          && sourceId !== `nested-composition:${referenceCompositionId}`)
      ) {
        fail('MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH', referencePath);
      }
      const child = inspectWorkerGpuFrameStackContract(
        dataValue(payload, 'stack', path, 'MD7_FRAME_STACK_INVALID_PAYLOAD'),
        `${path}.stack`,
        depth + 1,
        budget,
        containingFrame,
        admission,
      );
      if (
        child.frame.compositionId !== referenceCompositionId
        || child.frame.timelineTime !== referenceTimelineTime
        || child.occurrenceNamespace !== referenceNamespace
      ) {
        fail('MD7_FRAME_STACK_NESTED_REFERENCE_MISMATCH', `${path}.stack`);
      }
      break;
    }
    default:
      fail('MD7_FRAME_STACK_INVALID_PAYLOAD', `${path}.kind`);
  }

  if (!payloadSupportsSourceKind(
    kind as WorkerGpuFrameStackPayload['kind'],
    runtimeSourceKind,
  )) {
    fail('MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH', path);
  }
  assertPayloadSourceId(
    kind as WorkerGpuFrameStackPayload['kind'],
    sourceKind,
    sourceId,
    path,
  );
}

function assertBinding(
  value: unknown,
  index: number,
  path: string,
  frame: WorkerGpuFrameStackIdentity,
  occurrenceNamespace: string,
  depth: number,
  budget: ValidationBudget,
  admission: WorkerGpuFrameStackAdmission,
  bindingsByLayerId: Map<string, WorkerGpuFrameStackSourceBinding>,
): void {
  const record = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  assertExactKeys(record, [
    'layerId',
    'runtimeSourceKind',
    'sourceKind',
    'sourceId',
    'renderLayer',
    'payload',
  ], path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  const layerId = dataValue(record, 'layerId', path);
  if (!isMotionAdjustmentStableId(layerId)) {
    fail('MD7_FRAME_STACK_INVALID_LAYER_ID', `${path}.layerId`);
  }
  if (bindingsByLayerId.has(layerId)) {
    fail('MD7_FRAME_STACK_DUPLICATE_LAYER_ID', `${path}.layerId`);
  }
  const runtimeSourceKind = dataValue(record, 'runtimeSourceKind', path);
  if (!isRuntimeSourceKind(runtimeSourceKind)) {
    fail('MD7_FRAME_STACK_INVALID_RUNTIME_SOURCE_KIND', `${path}.runtimeSourceKind`);
  }
  const sourceKind = dataValue(record, 'sourceKind', path);
  if (!isMotionAdjustmentSourceKind(sourceKind)) {
    fail('MD7_FRAME_STACK_INVALID_SOURCE_KIND', `${path}.sourceKind`);
  }
  if (sourceKindForRuntimeKind(runtimeSourceKind) !== sourceKind) {
    fail('MD7_FRAME_STACK_RUNTIME_SOURCE_KIND_MISMATCH', `${path}.sourceKind`);
  }
  const sourceId = dataValue(record, 'sourceId', path);
  try {
    assertMotionAdjustmentSourceIdentity(sourceKind, sourceId);
  } catch {
    fail('MD7_FRAME_STACK_INVALID_SOURCE_ID', `${path}.sourceId`);
  }
  assertRenderLayer(
    dataValue(record, 'renderLayer', path),
    layerId,
    `${path}.renderLayer`,
    budget,
  );
  assertPayload(
    dataValue(record, 'payload', path),
    runtimeSourceKind,
    sourceKind,
    sourceId,
    frame,
    occurrenceNamespace,
    layerId,
    `${path}.payload`,
    depth,
    budget,
    admission,
  );
  bindingsByLayerId.set(layerId, value as WorkerGpuFrameStackSourceBinding);
  void index;
}

function assertExecutionBijection(
  layerIds: readonly unknown[],
  bindingsByLayerId: ReadonlyMap<string, WorkerGpuFrameStackSourceBinding>,
  path: string,
): void {
  if (layerIds.length !== bindingsByLayerId.size) {
    fail('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH', path);
  }
  const seen = new Set<string>();
  for (let index = 0; index < layerIds.length; index += 1) {
    const layerId = layerIds[index];
    if (
      !isMotionAdjustmentStableId(layerId)
      || seen.has(layerId)
      || !bindingsByLayerId.has(layerId)
    ) {
      fail('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH', `${path}[${index}]`);
    }
    seen.add(layerId);
  }
}

function assertPlanBindings(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
  bindingsByLayerId: ReadonlyMap<string, WorkerGpuFrameStackSourceBinding>,
  path: string,
): void {
  const resolvePasses = plan.passes.filter((pass) => pass.kind === 'resolve-source');
  assertExecutionBijection(resolvePasses.map((pass) => pass.layerId), bindingsByLayerId, path);
  for (let index = 0; index < resolvePasses.length; index += 1) {
    const pass = resolvePasses[index];
    const binding = bindingsByLayerId.get(pass.layerId);
    if (
      !binding
      || binding.sourceKind !== pass.sourceKind
      || binding.sourceId !== pass.sourceId
    ) {
      fail('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH', `${path}[${index}]`);
    }
  }
}

function planMatchesFrame(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
  frame: WorkerGpuFrameStackIdentity,
): boolean {
  return plan.frame.requestId === frame.requestId
    && plan.frame.targetId === frame.targetId
    && plan.frame.compositionId === frame.compositionId
    && plan.frame.timelineTime === frame.timelineTime
    && plan.frame.frameIndex === frame.frameIndex
    && plan.frame.intent === frame.intent
    && plan.frame.submitByMs === frame.submitByMs
    && plan.frame.expireAfterMs === frame.expireAfterMs
    && plan.frame.graphVersion === frame.graphVersion
    && plan.frame.exact === frame.exact;
}

function assertExecution(
  value: unknown,
  path: string,
  frame: WorkerGpuFrameStackIdentity,
  occurrenceNamespace: string,
  dimensions: WorkerGpuFrameStackDimensions,
  budget: ValidationBudget,
  bindingsByLayerId: ReadonlyMap<string, WorkerGpuFrameStackSourceBinding>,
  nested: boolean,
): void {
  const execution = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  const kind = dataValue(execution, 'kind', path);
  if (kind === 'ordered-sources') {
    assertExactKeys(execution, ['kind', 'bottomToTopLayerIds'], path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
    const layerIds = dataValue(execution, 'bottomToTopLayerIds', path);
    if (!Array.isArray(layerIds)) {
      fail('MD7_FRAME_STACK_PLAN_BINDING_MISMATCH', `${path}.bottomToTopLayerIds`);
    }
    assertExecutionBijection(layerIds, bindingsByLayerId, `${path}.bottomToTopLayerIds`);
    return;
  }
  if (kind !== 'frozen-adjustment') {
    fail('MD7_FRAME_STACK_INVALID_CONTRACT', `${path}.kind`);
  }
  assertExactKeys(execution, ['kind', 'plan'], path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  if (!Object.prototype.hasOwnProperty.call(execution, 'plan')) {
    fail(
      nested ? 'MD7_FRAME_STACK_NESTED_PLAN_REQUIRED' : 'MD7_FRAME_STACK_PLAN_INVALID',
      `${path}.plan`,
    );
  }
  const planValue = dataValue(
    execution,
    'plan',
    path,
    nested ? 'MD7_FRAME_STACK_NESTED_PLAN_REQUIRED' : 'MD7_FRAME_STACK_PLAN_INVALID',
  );
  try {
    assertMotionAdjustmentWorkerGpuExecutionPlan(planValue);
  } catch {
    fail('MD7_FRAME_STACK_PLAN_INVALID', `${path}.plan`);
  }
  const plan = planValue as MotionAdjustmentWorkerGpuExecutionPlan;
  if (!planMatchesFrame(plan, frame)) {
    fail('MD7_FRAME_STACK_FRAME_IDENTITY_MISMATCH', `${path}.plan.frame`);
  }
  if (plan.resourceNamespace !== occurrenceNamespace) {
    fail('MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH', `${path}.plan.resourceNamespace`);
  }
  assertPlanBindings(plan, bindingsByLayerId, `${path}.plan.passes`);
  const intermediateResourceCount = plan.resources.filter(
    (resource) => resource.kind !== 'source',
  ).length;
  chargePixels(
    dimensions.width,
    dimensions.height,
    intermediateResourceCount,
    `${path}.plan.resources`,
    budget,
  );
}

function inspectWorkerGpuFrameStackContract(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget,
  parentFrame: WorkerGpuFrameStackIdentity | null,
  admission: WorkerGpuFrameStackAdmission,
): WorkerGpuFrameStackContractV1 {
  if (depth > WORKER_GPU_FRAME_STACK_MAX_NESTING_DEPTH) {
    fail('MD7_FRAME_STACK_NESTING_DEPTH_EXCEEDED', path);
  }
  const root = requirePlainRecord(value, path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  assertExactKeys(root, [
    'contractVersion',
    'frameMode',
    'occurrenceNamespace',
    'dimensions',
    'frame',
    'execution',
    'bindings',
  ], path, 'MD7_FRAME_STACK_INVALID_CONTRACT');
  if (dataValue(root, 'contractVersion', path) !== WORKER_GPU_FRAME_STACK_CONTRACT_VERSION) {
    fail('MD7_FRAME_STACK_UNSUPPORTED_VERSION', `${path}.contractVersion`);
  }
  if (dataValue(root, 'frameMode', path) !== 'exact-one-shot') {
    fail('MD7_FRAME_STACK_EXACT_ONE_SHOT_REQUIRED', `${path}.frameMode`);
  }

  const occurrenceNamespace = dataValue(root, 'occurrenceNamespace', path);
  if (!isMotionAdjustmentStableId(occurrenceNamespace)) {
    fail('MD7_FRAME_STACK_NESTED_NAMESPACE_MISMATCH', `${path}.occurrenceNamespace`);
  }
  if (budget.occurrenceNamespaces.has(occurrenceNamespace)) {
    fail('MD7_FRAME_STACK_DUPLICATE_OCCURRENCE_NAMESPACE', `${path}.occurrenceNamespace`);
  }
  budget.occurrenceNamespaces.add(occurrenceNamespace);

  const dimensions = assertDimensions(
    dataValue(root, 'dimensions', path),
    `${path}.dimensions`,
    budget,
  );
  const frame = assertFrameIdentity(
    dataValue(root, 'frame', path),
    `${path}.frame`,
    parentFrame,
    admission,
  );
  if (budget.compositionAncestry.has(frame.compositionId)) {
    fail('MD7_FRAME_STACK_COMPOSITION_CYCLE', `${path}.frame.compositionId`);
  }

  const bindings = dataValue(root, 'bindings', path);
  if (!Array.isArray(bindings)) fail('MD7_FRAME_STACK_INVALID_CONTRACT', `${path}.bindings`);
  budget.totalBindings += bindings.length;
  if (budget.totalBindings > WORKER_GPU_FRAME_STACK_MAX_TOTAL_BINDINGS) {
    fail('MD7_FRAME_STACK_BINDING_BUDGET_EXCEEDED', `${path}.bindings`);
  }

  const bindingsByLayerId = new Map<string, WorkerGpuFrameStackSourceBinding>();
  budget.compositionAncestry.add(frame.compositionId);
  try {
    bindings.forEach((binding, index) => assertBinding(
      binding,
      index,
      `${path}.bindings[${index}]`,
      frame,
      occurrenceNamespace,
      depth,
      budget,
      admission,
      bindingsByLayerId,
    ));
  } finally {
    budget.compositionAncestry.delete(frame.compositionId);
  }

  assertExecution(
    dataValue(root, 'execution', path),
    `${path}.execution`,
    frame,
    occurrenceNamespace,
    dimensions,
    budget,
    bindingsByLayerId,
    depth > 0,
  );
  return value as WorkerGpuFrameStackContractV1;
}

export function validateWorkerGpuFrameStackContract(
  value: unknown,
  admission: WorkerGpuFrameStackAdmission,
): WorkerGpuFrameStackValidation {
  try {
    assertAdmission(admission);
    return {
      ok: true,
      contract: inspectWorkerGpuFrameStackContract(
        value,
        '$',
        0,
        {
          totalBindings: 0,
          totalPixels: 0,
          totalCloneNodes: 0,
          totalStringUnits: 0,
          occurrenceNamespaces: new Set<string>(),
          compositionAncestry: new Set<string>(),
          ownedBitmaps: new WeakSet<object>(),
        },
        null,
        admission,
      ),
    };
  } catch (error) {
    if (error instanceof WorkerGpuFrameStackContractError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        path: error.path,
      };
    }
    return {
      ok: false,
      code: 'MD7_FRAME_STACK_INVALID_CONTRACT',
      message: `[MD7_FRAME_STACK_INVALID_CONTRACT] ${DIAGNOSTIC_MESSAGES.MD7_FRAME_STACK_INVALID_CONTRACT} at $`,
      path: '$',
    };
  }
}

export function assertWorkerGpuFrameStackContract(
  value: unknown,
  admission: WorkerGpuFrameStackAdmission,
): asserts value is WorkerGpuFrameStackContractV1 {
  const result = validateWorkerGpuFrameStackContract(value, admission);
  if (!result.ok) throw new WorkerGpuFrameStackContractError(result.code, result.path);
}

function addBitmapTransferable(
  bitmap: ImageBitmap,
  seen: Set<ImageBitmap>,
  transferables: Transferable[],
): void {
  if (seen.has(bitmap)) return;
  seen.add(bitmap);
  transferables.push(bitmap as unknown as Transferable);
}

function collectStackTransferables(
  stack: WorkerGpuFrameStackContractV1,
  seen: Set<ImageBitmap>,
  transferables: Transferable[],
): void {
  for (const binding of stack.bindings) {
    if (binding.payload.kind === 'bitmap') {
      addBitmapTransferable(binding.payload.bitmap, seen, transferables);
    } else if (binding.payload.kind === 'nested-stack') {
      collectStackTransferables(binding.payload.stack, seen, transferables);
    }
  }
}

export function collectWorkerGpuFrameStackTransferables(
  contract: WorkerGpuFrameStackContractV1,
  admission: WorkerGpuFrameStackAdmission,
): readonly Transferable[] {
  assertWorkerGpuFrameStackContract(contract, admission);
  const seen = new Set<ImageBitmap>();
  const transferables: Transferable[] = [];
  collectStackTransferables(contract, seen, transferables);
  return transferables;
}

/** Best-effort terminal release for a transport payload rejected before materialization. */
export function closeWorkerGpuFrameStackTransferables(value: unknown): void {
  const closed = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null) return;
    const record = candidate as Record<string, unknown>;
    const bindings = record.bindings;
    if (!Array.isArray(bindings)) return;
    for (const binding of bindings) {
      if (typeof binding !== 'object' || binding === null) continue;
      const payload = (binding as Record<string, unknown>).payload;
      if (typeof payload !== 'object' || payload === null) continue;
      const payloadRecord = payload as Record<string, unknown>;
      if (payloadRecord.kind === 'bitmap') {
        const bitmap = payloadRecord.bitmap;
        if (typeof bitmap !== 'object' || bitmap === null || closed.has(bitmap)) continue;
        closed.add(bitmap);
        try {
          const close = (bitmap as { close?: unknown }).close;
          if (typeof close === 'function') close.call(bitmap);
        } catch {
          // Ownership is terminal even when a detached handle reports an error.
        }
      } else if (payloadRecord.kind === 'nested-stack') {
        visit(payloadRecord.stack);
      }
    }
  };
  visit(value);
}
