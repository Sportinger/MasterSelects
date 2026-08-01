import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import {
  MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentOperationPacket,
} from './contracts';
import {
  MOTION_ADJUSTMENT_RENDER_PLAN_VERSION,
  assertMotionAdjustmentEvaluatedRenderPlan,
  planMotionAdjustmentRenderGraph,
  type MotionAdjustmentEvaluatedRenderOperation,
  type MotionAdjustmentEvaluatedRenderPlan,
} from './renderGraphExecutor';
import type { MotionAdjustmentRenderSurface } from './supportedEffects';
import type {
  WorkerGpuRenderDeadline,
  WorkerGpuRenderIntent,
} from '../../render/workerGpuRuntimeCommands';

export const MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION =
  'motion-adjustment-worker-gpu-plan/v1' as const;
export const MOTION_ADJUSTMENT_WORKER_GPU_PARITY_VERSION =
  'motion-adjustment-worker-gpu-parity/v1' as const;

export interface MotionAdjustmentWorkerGpuPlanInput {
  readonly deadline: WorkerGpuRenderDeadline;
  readonly graphVersion: number;
  /** Main supplies a distinct value for every nested composition occurrence. */
  readonly resourceNamespace: string;
}

export interface MotionAdjustmentWorkerGpuFrameIdentity {
  readonly requestId: string;
  readonly targetId: string;
  readonly compositionId: string;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly intent: WorkerGpuRenderIntent;
  readonly submitByMs: number;
  readonly expireAfterMs: number;
  readonly exact: true;
  readonly graphVersion: number;
}

export type MotionAdjustmentWorkerGpuResourceKind =
  | 'accumulator'
  | 'source'
  | 'snapshot'
  | 'effect-intermediate'
  | 'mask-input';

export interface MotionAdjustmentWorkerGpuResource {
  readonly kind: MotionAdjustmentWorkerGpuResourceKind;
  readonly semanticRef: string;
  readonly resourceId: string;
  readonly ownerPassId: string;
}

export interface MotionAdjustmentWorkerGpuMaskResource {
  readonly maskId: string;
  readonly semanticRef: string;
  readonly resourceId: string;
}

interface MotionAdjustmentWorkerGpuPassBase {
  readonly passId: string;
  readonly passIndex: number;
  readonly operationSequence: number;
  readonly outputRef: string;
  readonly outputResourceId: string;
}

export interface MotionAdjustmentWorkerGpuInitializePass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'initialize-accumulator';
  readonly clear: 'transparent';
}

export interface MotionAdjustmentWorkerGpuResolveSourcePass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'resolve-source';
  readonly layerId: string;
  readonly sourceKind: 'timeline-media' | 'motion-media' | 'title' | 'nested-composition';
  readonly sourceId: string;
}

export interface MotionAdjustmentWorkerGpuCompositeSourcePass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'composite-source';
  readonly layerId: string;
  readonly lowerAccumulatorRef: string;
  readonly lowerAccumulatorResourceId: string;
  readonly sourceRef: string;
  readonly sourceResourceId: string;
  readonly mix: MotionAdjustmentMixContract;
  readonly maskResources: readonly MotionAdjustmentWorkerGpuMaskResource[];
}

export interface MotionAdjustmentWorkerGpuSnapshotPass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'snapshot-accumulator';
  readonly layerId: string;
  readonly inputRef: string;
  readonly inputResourceId: string;
}

export interface MotionAdjustmentWorkerGpuColorMatrixPass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'apply-adjustment-effect';
  readonly primitive: 'color-matrix-4x5';
  readonly layerId: string;
  readonly effectId: string;
  readonly effectType: 'brightness' | 'contrast' | 'saturation' | 'invert';
  readonly inputRef: string;
  readonly inputResourceId: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly matrix: readonly number[];
}

export interface MotionAdjustmentWorkerGpuGaussianBlurPass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'apply-adjustment-effect';
  readonly primitive: 'separable-gaussian-blur';
  readonly direction: 'horizontal' | 'vertical';
  readonly layerId: string;
  readonly effectId: string;
  readonly effectType: 'gaussian-blur';
  readonly inputRef: string;
  readonly inputResourceId: string;
  readonly parameters: Readonly<{ radius: number; samples: number }>;
}

export interface MotionAdjustmentWorkerGpuMixPass
  extends MotionAdjustmentWorkerGpuPassBase {
  readonly kind: 'mix-adjustment-result';
  readonly layerId: string;
  readonly preEffectSnapshotRef: string;
  readonly preEffectSnapshotResourceId: string;
  readonly processedAccumulatorRef: string;
  readonly processedAccumulatorResourceId: string;
  readonly mix: MotionAdjustmentMixContract;
  readonly maskResources: readonly MotionAdjustmentWorkerGpuMaskResource[];
}

export type MotionAdjustmentWorkerGpuPass =
  | MotionAdjustmentWorkerGpuInitializePass
  | MotionAdjustmentWorkerGpuResolveSourcePass
  | MotionAdjustmentWorkerGpuCompositeSourcePass
  | MotionAdjustmentWorkerGpuSnapshotPass
  | MotionAdjustmentWorkerGpuColorMatrixPass
  | MotionAdjustmentWorkerGpuGaussianBlurPass
  | MotionAdjustmentWorkerGpuMixPass;

export interface MotionAdjustmentWorkerGpuExecutionPlan {
  readonly contractVersion: typeof MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION;
  readonly operationPacketVersion: typeof MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION;
  readonly renderPlan: MotionAdjustmentEvaluatedRenderPlan;
  readonly frame: MotionAdjustmentWorkerGpuFrameIdentity;
  readonly resourceNamespace: string;
  readonly resources: readonly MotionAdjustmentWorkerGpuResource[];
  readonly passes: readonly MotionAdjustmentWorkerGpuPass[];
  readonly finalAccumulatorRef: string;
  readonly finalAccumulatorResourceId: string;
  readonly paritySignature: string;
}

/**
 * Main-thread admission entry point. It consumes the frozen operation packet,
 * so the worker mapping cannot become an independent adjustment semantics.
 */
export function planMotionAdjustmentWorkerGpuExecution(
  packet: MotionAdjustmentOperationPacket,
  surface: MotionAdjustmentRenderSurface,
  input: MotionAdjustmentWorkerGpuPlanInput,
): MotionAdjustmentWorkerGpuExecutionPlan {
  return planMotionAdjustmentWorkerGpuExecutionFromRenderPlan(
    planMotionAdjustmentRenderGraph(packet, surface),
    input,
  );
}

/** Allows Main to reuse an already admitted shared render plan. */
export function planMotionAdjustmentWorkerGpuExecutionFromRenderPlan(
  renderPlan: MotionAdjustmentEvaluatedRenderPlan,
  input: MotionAdjustmentWorkerGpuPlanInput,
): MotionAdjustmentWorkerGpuExecutionPlan {
  assertMotionAdjustmentEvaluatedRenderPlan(renderPlan);
  const frame = admitFrameIdentity(input, renderPlan);
  return buildWorkerGpuPlan(renderPlan, frame, input.resourceNamespace);
}

export function serializeMotionAdjustmentWorkerGpuExecutionPlan(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
): string {
  assertMotionAdjustmentWorkerGpuExecutionPlan(plan);
  return JSON.stringify(plan);
}

export function parseMotionAdjustmentWorkerGpuExecutionPlan(
  serialized: string,
): MotionAdjustmentWorkerGpuExecutionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Motion adjustment worker GPU plan is not valid JSON');
  }
  assertMotionAdjustmentWorkerGpuExecutionPlan(parsed);
  return parsed;
}

export function assertMotionAdjustmentWorkerGpuExecutionPlan(
  value: unknown,
): asserts value is MotionAdjustmentWorkerGpuExecutionPlan {
  assertMotionAdjustmentJsonData(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      'contractVersion',
      'operationPacketVersion',
      'renderPlan',
      'frame',
      'resourceNamespace',
      'resources',
      'passes',
      'finalAccumulatorRef',
      'finalAccumulatorResourceId',
      'paritySignature',
    ])
    || value.contractVersion !== MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION
    || value.operationPacketVersion !== MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION
    || !isPlainRecord(value.frame)
    || typeof value.resourceNamespace !== 'string'
  ) {
    throw new Error('Invalid motion adjustment worker GPU execution plan');
  }

  assertMotionAdjustmentEvaluatedRenderPlan(value.renderPlan);
  const frame = admitFrameIdentity({
    deadline: deadlineFromFrame(value.frame),
    graphVersion: value.frame.graphVersion as number,
    resourceNamespace: value.resourceNamespace,
  }, value.renderPlan);
  const expected = buildWorkerGpuPlan(
    value.renderPlan,
    frame,
    value.resourceNamespace,
  );
  if (stableStringify(value) !== stableStringify(expected)) {
    throw new Error('Motion adjustment worker GPU plan diverges from admitted semantics');
  }
}

function buildWorkerGpuPlan(
  sourceRenderPlan: MotionAdjustmentEvaluatedRenderPlan,
  frame: MotionAdjustmentWorkerGpuFrameIdentity,
  resourceNamespace: string,
): MotionAdjustmentWorkerGpuExecutionPlan {
  const renderPlan = cloneJson(sourceRenderPlan);
  assertMotionAdjustmentEvaluatedRenderPlan(renderPlan);

  const resources: MotionAdjustmentWorkerGpuResource[] = [];
  const passes: MotionAdjustmentWorkerGpuPass[] = [];
  const resourceIdsByRef = new Map<string, string>();

  const requireResource = (semanticRef: string): string => {
    const resourceId = resourceIdsByRef.get(semanticRef);
    if (!resourceId) {
      throw new Error(`Missing worker GPU adjustment resource: ${semanticRef}`);
    }
    return resourceId;
  };
  const publishResource = (
    kind: MotionAdjustmentWorkerGpuResourceKind,
    semanticRef: string,
    ownerPassId: string,
  ): string => {
    if (resourceIdsByRef.has(semanticRef)) {
      throw new Error(`Duplicate worker GPU adjustment resource: ${semanticRef}`);
    }
    const resourceId = createResourceId(resourceNamespace, frame, semanticRef);
    resourceIdsByRef.set(semanticRef, resourceId);
    resources.push({ kind, semanticRef, resourceId, ownerPassId });
    return resourceId;
  };
  const createMaskResources = (
    operation: MotionAdjustmentEvaluatedRenderOperation & { readonly layerId: string },
    mix: MotionAdjustmentMixContract,
    ownerPassId: string,
  ): MotionAdjustmentWorkerGpuMaskResource[] => mix.masks.map((mask) => {
    const semanticRef = stableStringify([
      'mask',
      operation.sequence,
      operation.layerId,
      mask.id,
    ]);
    return {
      maskId: mask.id,
      semanticRef,
      resourceId: publishResource('mask-input', semanticRef, ownerPassId),
    };
  });

  for (const operation of renderPlan.operations) {
    switch (operation.kind) {
      case 'initialize-accumulator': {
        const passId = createPassId(resourceNamespace, frame, operation.sequence, 'initialize');
        const outputResourceId = publishResource(
          'accumulator', operation.outputRef, passId,
        );
        passes.push({
          kind: operation.kind,
          passId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          outputRef: operation.outputRef,
          outputResourceId,
          clear: 'transparent',
        });
        break;
      }
      case 'resolve-source': {
        const passId = createPassId(resourceNamespace, frame, operation.sequence, 'resolve-source');
        const outputResourceId = publishResource('source', operation.outputRef, passId);
        passes.push({
          kind: operation.kind,
          passId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          sourceKind: operation.sourceKind,
          sourceId: operation.sourceId,
          outputRef: operation.outputRef,
          outputResourceId,
        });
        break;
      }
      case 'composite-source': {
        const passId = createPassId(resourceNamespace, frame, operation.sequence, 'composite-source');
        const outputResourceId = publishResource('accumulator', operation.outputRef, passId);
        passes.push({
          kind: operation.kind,
          passId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          lowerAccumulatorRef: operation.lowerAccumulatorRef,
          lowerAccumulatorResourceId: requireResource(operation.lowerAccumulatorRef),
          sourceRef: operation.sourceRef,
          sourceResourceId: requireResource(operation.sourceRef),
          mix: cloneMix(operation.mix),
          maskResources: createMaskResources(operation, operation.mix, passId),
          outputRef: operation.outputRef,
          outputResourceId,
        });
        break;
      }
      case 'snapshot-accumulator': {
        const passId = createPassId(resourceNamespace, frame, operation.sequence, 'snapshot');
        const outputResourceId = publishResource('snapshot', operation.outputRef, passId);
        passes.push({
          kind: operation.kind,
          passId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          inputRef: operation.inputRef,
          inputResourceId: requireResource(operation.inputRef),
          outputRef: operation.outputRef,
          outputResourceId,
        });
        break;
      }
      case 'apply-adjustment-effect': {
        if (operation.effect.primitive === 'color-matrix-4x5') {
          const passId = createPassId(
            resourceNamespace, frame, operation.sequence, 'color-matrix',
          );
          const outputResourceId = publishResource(
            'effect-intermediate', operation.outputRef, passId,
          );
          passes.push({
            kind: operation.kind,
            primitive: operation.effect.primitive,
            passId,
            passIndex: passes.length,
            operationSequence: operation.sequence,
            layerId: operation.layerId,
            effectId: operation.effectId,
            effectType: operation.effect.effectType,
            inputRef: operation.inputRef,
            inputResourceId: requireResource(operation.inputRef),
            parameters: { ...operation.effect.parameters },
            matrix: [...operation.effect.matrix],
            outputRef: operation.outputRef,
            outputResourceId,
          });
          break;
        }
        if (operation.effect.primitive !== 'separable-gaussian-blur') {
          throw new Error('Unsupported worker GPU adjustment effect primitive');
        }
        const horizontalRef = stableStringify([
          'blur-horizontal',
          operation.sequence,
          operation.layerId,
          operation.effectId,
        ]);
        const horizontalPassId = createPassId(
          resourceNamespace, frame, operation.sequence, 'blur-horizontal',
        );
        const horizontalResourceId = publishResource(
          'effect-intermediate', horizontalRef, horizontalPassId,
        );
        passes.push({
          kind: operation.kind,
          primitive: operation.effect.primitive,
          direction: 'horizontal',
          passId: horizontalPassId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          effectId: operation.effectId,
          effectType: operation.effect.effectType,
          inputRef: operation.inputRef,
          inputResourceId: requireResource(operation.inputRef),
          parameters: { ...operation.effect.parameters },
          outputRef: horizontalRef,
          outputResourceId: horizontalResourceId,
        });
        const verticalPassId = createPassId(
          resourceNamespace, frame, operation.sequence, 'blur-vertical',
        );
        const verticalResourceId = publishResource(
          'effect-intermediate', operation.outputRef, verticalPassId,
        );
        passes.push({
          kind: operation.kind,
          primitive: operation.effect.primitive,
          direction: 'vertical',
          passId: verticalPassId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          effectId: operation.effectId,
          effectType: operation.effect.effectType,
          inputRef: horizontalRef,
          inputResourceId: horizontalResourceId,
          parameters: { ...operation.effect.parameters },
          outputRef: operation.outputRef,
          outputResourceId: verticalResourceId,
        });
        break;
      }
      case 'mix-adjustment-result': {
        const passId = createPassId(resourceNamespace, frame, operation.sequence, 'mix-adjustment');
        const outputResourceId = publishResource('accumulator', operation.outputRef, passId);
        passes.push({
          kind: operation.kind,
          passId,
          passIndex: passes.length,
          operationSequence: operation.sequence,
          layerId: operation.layerId,
          preEffectSnapshotRef: operation.preEffectSnapshotRef,
          preEffectSnapshotResourceId: requireResource(operation.preEffectSnapshotRef),
          processedAccumulatorRef: operation.processedAccumulatorRef,
          processedAccumulatorResourceId: requireResource(operation.processedAccumulatorRef),
          mix: cloneMix(operation.mix),
          maskResources: createMaskResources(operation, operation.mix, passId),
          outputRef: operation.outputRef,
          outputResourceId,
        });
        break;
      }
    }
  }

  const finalAccumulatorResourceId = requireResource(renderPlan.finalAccumulatorRef);
  const plan: MotionAdjustmentWorkerGpuExecutionPlan = {
    contractVersion: MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION,
    operationPacketVersion: MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
    renderPlan,
    frame: { ...frame },
    resourceNamespace,
    resources,
    passes,
    finalAccumulatorRef: renderPlan.finalAccumulatorRef,
    finalAccumulatorResourceId,
    paritySignature: createParitySignature(renderPlan, frame),
  };
  return deepFreezeJson(plan);
}

function admitFrameIdentity(
  input: MotionAdjustmentWorkerGpuPlanInput,
  renderPlan: MotionAdjustmentEvaluatedRenderPlan,
): MotionAdjustmentWorkerGpuFrameIdentity {
  assertMotionAdjustmentJsonData(input);
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, ['deadline', 'graphVersion', 'resourceNamespace'])
    || !isPlainRecord(input.deadline)
    || !hasExactKeys(input.deadline, [
      'requestId',
      'targetId',
      'compositionId',
      'timelineTime',
      'frameIndex',
      'intent',
      'submitByMs',
      'expireAfterMs',
      'exact',
    ])
    || !isMotionAdjustmentStableId(input.deadline.requestId)
    || !isMotionAdjustmentStableId(input.deadline.targetId)
    || !isMotionAdjustmentStableId(input.deadline.compositionId)
    || !isFiniteNumber(input.deadline.timelineTime)
    || !isSafeNonNegativeInteger(input.deadline.frameIndex)
    || !isWorkerGpuIntent(input.deadline.intent)
    || !isFiniteNumber(input.deadline.submitByMs)
    || !isFiniteNumber(input.deadline.expireAfterMs)
    || input.deadline.exact !== true
    || !isSafeNonNegativeInteger(input.graphVersion)
    || !isMotionAdjustmentStableId(input.resourceNamespace)
  ) {
    throw new Error('Invalid exact worker GPU adjustment frame identity');
  }
  if (
    input.deadline.compositionId !== renderPlan.compositionId
    || input.deadline.timelineTime !== renderPlan.evaluationTime
  ) {
    throw new Error('Worker GPU adjustment frame identity does not match the render plan');
  }
  return {
    ...input.deadline,
    exact: true,
    graphVersion: input.graphVersion,
  };
}

function deadlineFromFrame(frame: Record<string, unknown>): WorkerGpuRenderDeadline {
  if (!hasExactKeys(frame, [
    'requestId',
    'targetId',
    'compositionId',
    'timelineTime',
    'frameIndex',
    'intent',
    'submitByMs',
    'expireAfterMs',
    'exact',
    'graphVersion',
  ])) {
    throw new Error('Invalid worker GPU adjustment plan frame');
  }
  return {
    requestId: frame.requestId as string,
    targetId: frame.targetId as string,
    compositionId: frame.compositionId as string,
    timelineTime: frame.timelineTime as number,
    frameIndex: frame.frameIndex as number,
    intent: frame.intent as WorkerGpuRenderIntent,
    submitByMs: frame.submitByMs as number,
    expireAfterMs: frame.expireAfterMs as number,
    exact: frame.exact as boolean,
  };
}

function createPassId(
  resourceNamespace: string,
  frame: MotionAdjustmentWorkerGpuFrameIdentity,
  operationSequence: number,
  subpass: string,
): string {
  return stableStringify([
    MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION,
    'pass',
    resourceNamespace,
    frame.compositionId,
    frame.graphVersion,
    frame.frameIndex,
    operationSequence,
    subpass,
  ]);
}

function createResourceId(
  resourceNamespace: string,
  frame: MotionAdjustmentWorkerGpuFrameIdentity,
  semanticRef: string,
): string {
  return stableStringify([
    MOTION_ADJUSTMENT_WORKER_GPU_PLAN_VERSION,
    'resource',
    resourceNamespace,
    frame.compositionId,
    frame.graphVersion,
    frame.frameIndex,
    semanticRef,
  ]);
}

function createParitySignature(
  renderPlan: MotionAdjustmentEvaluatedRenderPlan,
  frame: MotionAdjustmentWorkerGpuFrameIdentity,
): string {
  const canonicalSemantics = stableStringify({
    parityVersion: MOTION_ADJUSTMENT_WORKER_GPU_PARITY_VERSION,
    operationPacketVersion: MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
    renderPlanVersion: MOTION_ADJUSTMENT_RENDER_PLAN_VERSION,
    revision: renderPlan.revision,
    compositionId: renderPlan.compositionId,
    evaluationTime: renderPlan.evaluationTime,
    inputOrder: renderPlan.inputOrder,
    operationOrder: renderPlan.operationOrder,
    operations: renderPlan.operations,
    finalAccumulatorRef: renderPlan.finalAccumulatorRef,
    frameIndex: frame.frameIndex,
    graphVersion: frame.graphVersion,
    exact: frame.exact,
  });
  return [
    MOTION_ADJUSTMENT_WORKER_GPU_PARITY_VERSION,
    hashString(canonicalSemantics, 0x811c9dc5),
    hashString(canonicalSemantics, 0x9e3779b1),
    canonicalSemantics.length,
  ].join(':');
}

function hashString(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function cloneMix(mix: MotionAdjustmentMixContract): MotionAdjustmentMixContract {
  return {
    opacity: mix.opacity,
    blendMode: mix.blendMode,
    masks: mix.masks.map((mask) => ({
      id: mask.id,
      mode: mask.mode,
      inverted: mask.inverted,
      opacity: mask.opacity,
      feather: mask.feather,
      points: mask.points.map((point) => ({ ...point })),
    })),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(',')}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isWorkerGpuIntent(value: unknown): value is WorkerGpuRenderIntent {
  return value === 'playback'
    || value === 'scrub'
    || value === 'seek'
    || value === 'preview'
    || value === 'export'
    || value === 'proof';
}
