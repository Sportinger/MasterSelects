import { assertMotionAdjustmentJsonData } from './contractLimits';
import {
  MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
  assertMotionAdjustmentOperationPacket,
  parseMotionAdjustmentOperationPacket,
  serializeMotionAdjustmentOperationPacket,
  type JsonObject,
  type MotionAdjustmentCompositorOperation,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentOperationPacket,
} from './contracts';
import {
  planMotionAdjustmentEffectAdapter,
  type MotionAdjustmentEvaluatedEffect,
} from './effectAdapter';
import type { MotionAdjustmentRenderSurface } from './supportedEffects';

export const MOTION_ADJUSTMENT_RENDER_PLAN_VERSION =
  'motion-adjustment-render-plan/v1' as const;

interface EvaluatedOperationBase {
  readonly sequence: number;
  readonly outputRef: string;
}

export interface EvaluatedInitializeAccumulatorOperation
  extends EvaluatedOperationBase {
  readonly kind: 'initialize-accumulator';
}

export interface EvaluatedResolveSourceOperation extends EvaluatedOperationBase {
  readonly kind: 'resolve-source';
  readonly layerId: string;
  readonly sourceKind: 'timeline-media' | 'motion-media' | 'title' | 'nested-composition';
  readonly sourceId: string;
}

export interface EvaluatedCompositeSourceOperation extends EvaluatedOperationBase {
  readonly kind: 'composite-source';
  readonly layerId: string;
  readonly lowerAccumulatorRef: string;
  readonly sourceRef: string;
  readonly mix: MotionAdjustmentMixContract;
}

export interface EvaluatedSnapshotAccumulatorOperation
  extends EvaluatedOperationBase {
  readonly kind: 'snapshot-accumulator';
  readonly layerId: string;
  readonly inputRef: string;
}

export interface EvaluatedApplyEffectOperation extends EvaluatedOperationBase {
  readonly kind: 'apply-adjustment-effect';
  readonly layerId: string;
  readonly effectId: string;
  readonly inputRef: string;
  readonly effect: MotionAdjustmentEvaluatedEffect;
}

export interface EvaluatedMixAdjustmentOperation extends EvaluatedOperationBase {
  readonly kind: 'mix-adjustment-result';
  readonly layerId: string;
  readonly preEffectSnapshotRef: string;
  readonly processedAccumulatorRef: string;
  readonly mix: MotionAdjustmentMixContract;
}

export type MotionAdjustmentEvaluatedRenderOperation =
  | EvaluatedInitializeAccumulatorOperation
  | EvaluatedResolveSourceOperation
  | EvaluatedCompositeSourceOperation
  | EvaluatedSnapshotAccumulatorOperation
  | EvaluatedApplyEffectOperation
  | EvaluatedMixAdjustmentOperation;

export interface MotionAdjustmentEvaluatedRenderPlan {
  readonly contractVersion: typeof MOTION_ADJUSTMENT_RENDER_PLAN_VERSION;
  readonly surface: MotionAdjustmentRenderSurface;
  readonly revision: number;
  readonly compositionId: string;
  readonly evaluationTime: number;
  readonly inputOrder: 'top-to-bottom';
  readonly operationOrder: 'bottom-to-top';
  readonly operations: readonly MotionAdjustmentEvaluatedRenderOperation[];
  readonly finalAccumulatorRef: string;
}

export interface MotionAdjustmentRenderBackend<TValue> {
  initializeAccumulator(
    operation: EvaluatedInitializeAccumulatorOperation,
  ): TValue;
  resolveSource(operation: EvaluatedResolveSourceOperation): TValue;
  compositeSource(
    operation: EvaluatedCompositeSourceOperation,
    lowerAccumulator: TValue,
    source: TValue,
  ): TValue;
  snapshotAccumulator(
    operation: EvaluatedSnapshotAccumulatorOperation,
    accumulator: TValue,
  ): TValue;
  applyAdjustmentEffect(
    operation: EvaluatedApplyEffectOperation,
    accumulator: TValue,
  ): TValue;
  mixAdjustmentResult(
    operation: EvaluatedMixAdjustmentOperation,
    preEffectSnapshot: TValue,
    processedAccumulator: TValue,
  ): TValue;
}

export interface MotionAdjustmentExecutionResult<TValue> {
  readonly finalValue: TValue;
  readonly finalAccumulatorRef: string;
  readonly executedOperationCount: number;
  readonly values: readonly Readonly<{ ref: string; value: TValue }>[];
}

/** One renderer-neutral operation list shared by every render surface. */
export function planMotionAdjustmentRenderGraph(
  packet: MotionAdjustmentOperationPacket,
  surface: MotionAdjustmentRenderSurface,
): MotionAdjustmentEvaluatedRenderPlan {
  assertSurface(surface);
  const admittedPacket = parseMotionAdjustmentOperationPacket(
    serializeMotionAdjustmentOperationPacket(packet),
  );
  const plan: MotionAdjustmentEvaluatedRenderPlan = {
    contractVersion: MOTION_ADJUSTMENT_RENDER_PLAN_VERSION,
    surface,
    revision: admittedPacket.revision,
    compositionId: admittedPacket.compositionId,
    evaluationTime: admittedPacket.evaluationTime,
    inputOrder: admittedPacket.inputOrder,
    operationOrder: admittedPacket.operationOrder,
    operations: mapPacketOperations(admittedPacket.operations),
    finalAccumulatorRef: admittedPacket.finalAccumulatorRef,
  };
  assertMotionAdjustmentEvaluatedRenderPlan(plan);
  return plan;
}

export function assertMotionAdjustmentEvaluatedRenderPlan(
  value: unknown,
): asserts value is MotionAdjustmentEvaluatedRenderPlan {
  assertMotionAdjustmentJsonData(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      'contractVersion',
      'surface',
      'revision',
      'compositionId',
      'evaluationTime',
      'inputOrder',
      'operationOrder',
      'operations',
      'finalAccumulatorRef',
    ])
    || value.contractVersion !== MOTION_ADJUSTMENT_RENDER_PLAN_VERSION
    || !isSurface(value.surface)
    || !Array.isArray(value.operations)
  ) {
    throw new Error('Invalid motion adjustment evaluated render plan');
  }
  const packet = reconstructOperationPacket(value);
  assertMotionAdjustmentOperationPacket(packet);
  const expectedOperations = mapPacketOperations(packet.operations);
  if (
    JSON.stringify(value.operations) !== JSON.stringify(expectedOperations)
  ) {
    throw new Error('Motion adjustment evaluated render plan diverges from packet semantics');
  }
}

/**
 * Executes only after the complete plan and complete backend surface have been
 * admitted, so a malformed late effect can never trigger partial callbacks.
 */
export function executeMotionAdjustmentRenderGraph<TValue>(
  plan: MotionAdjustmentEvaluatedRenderPlan,
  backend: MotionAdjustmentRenderBackend<TValue>,
): MotionAdjustmentExecutionResult<TValue> {
  assertMotionAdjustmentEvaluatedRenderPlan(plan);
  const admittedBackend = admitBackend(backend);
  const valuesByRef = new Map<string, TValue>();
  const values: Array<Readonly<{ ref: string; value: TValue }>> = [];

  const publish = (reference: string, value: TValue): void => {
    valuesByRef.set(reference, value);
    values.push(Object.freeze({ ref: reference, value }));
  };
  const requireValue = (reference: string): TValue => {
    if (!valuesByRef.has(reference)) {
      throw new Error(`Missing executed motion adjustment reference: ${reference}`);
    }
    return valuesByRef.get(reference)!;
  };

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case 'initialize-accumulator':
        publish(operation.outputRef, admittedBackend.initializeAccumulator(operation));
        break;
      case 'resolve-source':
        publish(operation.outputRef, admittedBackend.resolveSource(operation));
        break;
      case 'composite-source':
        publish(operation.outputRef, admittedBackend.compositeSource(
          operation,
          requireValue(operation.lowerAccumulatorRef),
          requireValue(operation.sourceRef),
        ));
        break;
      case 'snapshot-accumulator':
        publish(operation.outputRef, admittedBackend.snapshotAccumulator(
          operation,
          requireValue(operation.inputRef),
        ));
        break;
      case 'apply-adjustment-effect':
        publish(operation.outputRef, admittedBackend.applyAdjustmentEffect(
          operation,
          requireValue(operation.inputRef),
        ));
        break;
      case 'mix-adjustment-result':
        publish(operation.outputRef, admittedBackend.mixAdjustmentResult(
          operation,
          requireValue(operation.preEffectSnapshotRef),
          requireValue(operation.processedAccumulatorRef),
        ));
        break;
    }
  }

  return Object.freeze({
    finalValue: requireValue(plan.finalAccumulatorRef),
    finalAccumulatorRef: plan.finalAccumulatorRef,
    executedOperationCount: plan.operations.length,
    values: Object.freeze(values),
  });
}

function mapPacketOperations(
  operations: readonly MotionAdjustmentCompositorOperation[],
): MotionAdjustmentEvaluatedRenderOperation[] {
  return operations.map((operation, sequence) => {
    switch (operation.type) {
      case 'initialize-accumulator':
        return { kind: operation.type, sequence, outputRef: operation.outputRef };
      case 'resolve-source':
        return {
          kind: operation.type,
          sequence,
          layerId: operation.layerId,
          sourceKind: operation.sourceKind,
          sourceId: operation.sourceId,
          outputRef: operation.outputRef,
        };
      case 'composite-source':
        return {
          kind: operation.type,
          sequence,
          layerId: operation.layerId,
          lowerAccumulatorRef: operation.lowerAccumulatorRef,
          sourceRef: operation.sourceRef,
          mix: cloneMix(operation.mix),
          outputRef: operation.outputRef,
        };
      case 'snapshot-accumulator':
        return {
          kind: operation.type,
          sequence,
          layerId: operation.layerId,
          inputRef: operation.inputRef,
          outputRef: operation.outputRef,
        };
      case 'apply-adjustment-effect':
        return {
          kind: operation.type,
          sequence,
          layerId: operation.layerId,
          effectId: operation.effectId,
          inputRef: operation.inputRef,
          effect: planMotionAdjustmentEffectAdapter(operation),
          outputRef: operation.outputRef,
        };
      case 'mix-adjustment-result':
        return {
          kind: operation.type,
          sequence,
          layerId: operation.layerId,
          preEffectSnapshotRef: operation.preEffectSnapshotRef,
          processedAccumulatorRef: operation.processedAccumulatorRef,
          mix: cloneMix(operation.mix),
          outputRef: operation.outputRef,
        };
    }
  });
}

function reconstructOperationPacket(
  plan: Record<string, unknown>,
): MotionAdjustmentOperationPacket {
  const rawOperations = plan.operations as unknown[];
  return {
    contractVersion: MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
    revision: plan.revision as number,
    compositionId: plan.compositionId as string,
    evaluationTime: plan.evaluationTime as number,
    inputOrder: plan.inputOrder as 'top-to-bottom',
    operationOrder: plan.operationOrder as 'bottom-to-top',
    operations: rawOperations.map(reconstructOperation),
    finalAccumulatorRef: plan.finalAccumulatorRef as string,
  };
}

function reconstructOperation(
  raw: unknown,
  sequence: number,
): MotionAdjustmentCompositorOperation {
  if (!isPlainRecord(raw) || raw.sequence !== sequence || typeof raw.kind !== 'string') {
    throw new Error('Invalid motion adjustment evaluated operation sequence');
  }
  switch (raw.kind) {
    case 'initialize-accumulator':
      assertEvaluatedOperationKeys(raw, ['kind', 'sequence', 'outputRef']);
      return {
        type: raw.kind,
        outputRef: raw.outputRef as string,
      };
    case 'resolve-source':
      assertEvaluatedOperationKeys(raw, [
        'kind',
        'sequence',
        'layerId',
        'sourceKind',
        'sourceId',
        'outputRef',
      ]);
      return {
        type: raw.kind,
        layerId: raw.layerId as string,
        sourceKind: raw.sourceKind as EvaluatedResolveSourceOperation['sourceKind'],
        sourceId: raw.sourceId as string,
        outputRef: raw.outputRef as string,
      };
    case 'composite-source':
      assertEvaluatedOperationKeys(raw, [
        'kind',
        'sequence',
        'layerId',
        'lowerAccumulatorRef',
        'sourceRef',
        'mix',
        'outputRef',
      ]);
      return {
        type: raw.kind,
        layerId: raw.layerId as string,
        lowerAccumulatorRef: raw.lowerAccumulatorRef as string,
        sourceRef: raw.sourceRef as string,
        mix: raw.mix as unknown as MotionAdjustmentMixContract,
        outputRef: raw.outputRef as string,
      };
    case 'snapshot-accumulator':
      assertEvaluatedOperationKeys(raw, [
        'kind',
        'sequence',
        'layerId',
        'inputRef',
        'outputRef',
      ]);
      return {
        type: raw.kind,
        layerId: raw.layerId as string,
        inputRef: raw.inputRef as string,
        outputRef: raw.outputRef as string,
      };
    case 'apply-adjustment-effect': {
      assertEvaluatedOperationKeys(raw, [
        'kind',
        'sequence',
        'layerId',
        'effectId',
        'inputRef',
        'effect',
        'outputRef',
      ]);
      if (!isPlainRecord(raw.effect)) {
        throw new Error('Invalid evaluated motion adjustment effect');
      }
      return {
        type: raw.kind,
        layerId: raw.layerId as string,
        effectId: raw.effectId as string,
        effectType: raw.effect.effectType as string,
        parameters: raw.effect.parameters as JsonObject,
        inputRef: raw.inputRef as string,
        outputRef: raw.outputRef as string,
      };
    }
    case 'mix-adjustment-result':
      assertEvaluatedOperationKeys(raw, [
        'kind',
        'sequence',
        'layerId',
        'preEffectSnapshotRef',
        'processedAccumulatorRef',
        'mix',
        'outputRef',
      ]);
      return {
        type: raw.kind,
        layerId: raw.layerId as string,
        preEffectSnapshotRef: raw.preEffectSnapshotRef as string,
        processedAccumulatorRef: raw.processedAccumulatorRef as string,
        mix: raw.mix as unknown as MotionAdjustmentMixContract,
        outputRef: raw.outputRef as string,
      };
    default:
      throw new Error('Unknown motion adjustment evaluated operation');
  }
}

function assertEvaluatedOperationKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (!hasExactKeys(value, keys)) {
    throw new Error('Invalid motion adjustment evaluated operation shape');
  }
}

function admitBackend<TValue>(
  backend: MotionAdjustmentRenderBackend<TValue>,
): MotionAdjustmentRenderBackend<TValue> {
  if (
    !backend
    || typeof backend.initializeAccumulator !== 'function'
    || typeof backend.resolveSource !== 'function'
    || typeof backend.compositeSource !== 'function'
    || typeof backend.snapshotAccumulator !== 'function'
    || typeof backend.applyAdjustmentEffect !== 'function'
    || typeof backend.mixAdjustmentResult !== 'function'
  ) {
    throw new Error('Incomplete motion adjustment render backend');
  }
  return backend;
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
      points: mask.points.map((point) => ({ x: point.x, y: point.y })),
    })),
  };
}

function assertSurface(value: unknown): asserts value is MotionAdjustmentRenderSurface {
  if (!isSurface(value)) throw new Error('Invalid motion adjustment render surface');
}

function isSurface(value: unknown): value is MotionAdjustmentRenderSurface {
  return value === 'preview'
    || value === 'nested-preview'
    || value === 'target-preview'
    || value === 'export';
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
