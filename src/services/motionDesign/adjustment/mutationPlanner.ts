import {
  IDENTITY_ADJUSTMENT_TRANSFORM,
  type MotionAdjustmentEffectContract,
  type MotionAdjustmentLayerContract,
  type MotionAdjustmentMixContract,
  type MotionAdjustmentStackContract,
  type MotionAdjustmentStackLayerContract,
  type MotionAdjustmentTimeRange,
} from './contracts';
import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import { planMotionAdjustmentOperations } from './operationPlanner';
import { assertMotionAdjustmentRevision } from './revisionContract';

export const MOTION_ADJUSTMENT_MUTATION_PLAN_VERSION =
  'motion-adjustment-mutation-plan/v1' as const;

export type MotionAdjustmentMutationKind =
  | 'create'
  | 'configure'
  | 'move'
  | 'trim'
  | 'remove';

export interface MotionAdjustmentMutationDirection {
  readonly expectedRevision: number;
  readonly nextRevision: number;
  readonly stack: MotionAdjustmentStackContract;
}

export interface MotionAdjustmentMutationPlan {
  readonly contractVersion: typeof MOTION_ADJUSTMENT_MUTATION_PLAN_VERSION;
  readonly kind: MotionAdjustmentMutationKind;
  readonly layerId: string;
  readonly ordering: {
    readonly inputOrder: 'top-to-bottom';
    readonly beforeIndex: number | null;
    readonly afterIndex: number | null;
    readonly beforeLowerLayerIds: readonly string[];
    readonly afterLowerLayerIds: readonly string[];
  };
  readonly apply: MotionAdjustmentMutationDirection;
  readonly undo: MotionAdjustmentMutationDirection;
  readonly history: {
    readonly mode: 'single-entry';
    readonly atomic: true;
    readonly label: string;
  };
}

export interface CreateMotionAdjustmentInput {
  readonly expectedRevision: number;
  readonly insertIndex: number;
  readonly layer: MotionAdjustmentLayerContract;
}

export interface ConfigureMotionAdjustmentInput {
  readonly expectedRevision: number;
  readonly layerId: string;
  readonly enabled?: boolean;
  readonly effects?: readonly MotionAdjustmentEffectContract[];
  readonly mix?: MotionAdjustmentMixContract;
}

export interface MoveMotionAdjustmentInput {
  readonly expectedRevision: number;
  readonly layerId: string;
  readonly toIndex: number;
}

export interface TrimMotionAdjustmentInput {
  readonly expectedRevision: number;
  readonly layerId: string;
  readonly activeRange: MotionAdjustmentTimeRange;
}

export interface RemoveMotionAdjustmentInput {
  readonly expectedRevision: number;
  readonly layerId: string;
}

export function planCreateMotionAdjustment(
  stack: MotionAdjustmentStackContract,
  input: CreateMotionAdjustmentInput,
): MotionAdjustmentMutationPlan {
  admitInputs(stack, input);
  if (
    !hasExactKeys(input, ['expectedRevision', 'insertIndex', 'layer'])
    || !Number.isInteger(input.insertIndex)
    || input.insertIndex < 0
    || input.insertIndex > stack.layers.length
    || input.layer.kind !== 'adjustment'
  ) {
    throw new Error('Invalid create motion adjustment input');
  }
  if (stack.layers.some((layer) => layer.layerId === input.layer.layerId)) {
    throw new Error(`Motion adjustment layer already exists: ${input.layer.layerId}`);
  }

  const validationLayers = cloneLayers(stack.layers);
  validationLayers.splice(input.insertIndex, 0, input.layer);
  assertCandidateLayers(stack, validationLayers);
  const nextLayers = cloneLayers(validationLayers);
  return buildMutationPlan(
    'create',
    stack,
    nextLayers,
    input.layer.layerId,
    null,
    input.insertIndex,
  );
}

export function planConfigureMotionAdjustment(
  stack: MotionAdjustmentStackContract,
  input: ConfigureMotionAdjustmentInput,
): MotionAdjustmentMutationPlan {
  admitInputs(stack, input);
  const keys = Object.keys(input);
  if (
    !keys.every((key) => [
      'expectedRevision',
      'layerId',
      'enabled',
      'effects',
      'mix',
    ].includes(key))
    || keys.length < 3
    || !isMotionAdjustmentStableId(input.layerId)
    || (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    || (input.effects !== undefined && !Array.isArray(input.effects))
    || (input.mix !== undefined && !isPlainRecord(input.mix))
  ) {
    throw new Error('Invalid configure motion adjustment input');
  }
  const index = requireAdjustmentIndex(stack, input.layerId);
  const validationLayers = cloneLayers(stack.layers);
  const current = validationLayers[index];
  if (!current || current.kind !== 'adjustment') {
    throw new Error(`Expected adjustment layer: ${input.layerId}`);
  }
  validationLayers[index] = {
    ...current,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.effects === undefined
      ? {}
      : { effects: [...input.effects] }),
    ...(input.mix === undefined ? {} : { mix: input.mix }),
  };
  assertCandidateLayers(stack, validationLayers);
  const nextLayers = cloneLayers(validationLayers);
  return buildMutationPlan(
    'configure',
    stack,
    nextLayers,
    input.layerId,
    index,
    index,
  );
}

export function planMoveMotionAdjustment(
  stack: MotionAdjustmentStackContract,
  input: MoveMotionAdjustmentInput,
): MotionAdjustmentMutationPlan {
  admitInputs(stack, input);
  if (
    !hasExactKeys(input, ['expectedRevision', 'layerId', 'toIndex'])
    || !isMotionAdjustmentStableId(input.layerId)
    || !Number.isInteger(input.toIndex)
    || input.toIndex < 0
    || input.toIndex >= stack.layers.length
  ) {
    throw new Error('Invalid move motion adjustment input');
  }
  const beforeIndex = requireAdjustmentIndex(stack, input.layerId);
  if (beforeIndex === input.toIndex) {
    throw new Error('Motion adjustment move must change ordering');
  }
  const nextLayers = cloneLayers(stack.layers);
  const [layer] = nextLayers.splice(beforeIndex, 1);
  if (!layer) throw new Error(`Missing adjustment layer: ${input.layerId}`);
  nextLayers.splice(input.toIndex, 0, layer);
  return buildMutationPlan(
    'move',
    stack,
    nextLayers,
    input.layerId,
    beforeIndex,
    input.toIndex,
  );
}

export function planTrimMotionAdjustment(
  stack: MotionAdjustmentStackContract,
  input: TrimMotionAdjustmentInput,
): MotionAdjustmentMutationPlan {
  admitInputs(stack, input);
  if (
    !hasExactKeys(input, ['expectedRevision', 'layerId', 'activeRange'])
    || !isMotionAdjustmentStableId(input.layerId)
  ) {
    throw new Error('Invalid trim motion adjustment input');
  }
  const index = requireAdjustmentIndex(stack, input.layerId);
  const validationLayers = cloneLayers(stack.layers);
  const current = validationLayers[index];
  if (!current || current.kind !== 'adjustment') {
    throw new Error(`Expected adjustment layer: ${input.layerId}`);
  }
  validationLayers[index] = {
    ...current,
    activeRange: input.activeRange,
  };
  assertCandidateLayers(stack, validationLayers);
  const nextLayers = cloneLayers(validationLayers);
  return buildMutationPlan(
    'trim',
    stack,
    nextLayers,
    input.layerId,
    index,
    index,
  );
}

export function planRemoveMotionAdjustment(
  stack: MotionAdjustmentStackContract,
  input: RemoveMotionAdjustmentInput,
): MotionAdjustmentMutationPlan {
  admitInputs(stack, input);
  if (
    !hasExactKeys(input, ['expectedRevision', 'layerId'])
    || !isMotionAdjustmentStableId(input.layerId)
  ) {
    throw new Error('Invalid remove motion adjustment input');
  }
  const beforeIndex = requireAdjustmentIndex(stack, input.layerId);
  const nextLayers = cloneLayers(stack.layers);
  nextLayers.splice(beforeIndex, 1);
  return buildMutationPlan(
    'remove',
    stack,
    nextLayers,
    input.layerId,
    beforeIndex,
    null,
  );
}

export function createDefaultMotionAdjustmentLayer(
  layerId: string,
  activeRange: MotionAdjustmentTimeRange,
): MotionAdjustmentLayerContract {
  assertMotionAdjustmentJsonData(activeRange);
  if (
    !isPlainRecord(activeRange)
    || !hasExactKeys(activeRange, ['start', 'end'])
    || !isFiniteNumber(activeRange.start)
    || !isFiniteNumber(activeRange.end)
    || activeRange.end < activeRange.start
  ) {
    throw new Error('Invalid motion adjustment active range');
  }
  const layer: MotionAdjustmentLayerContract = {
    kind: 'adjustment',
    layerId,
    enabled: true,
    activeRange: { start: activeRange.start, end: activeRange.end },
    transform: { ...IDENTITY_ADJUSTMENT_TRANSFORM },
    mix: { opacity: 1, blendMode: 'normal', masks: [] },
    effects: [],
  };
  assertMotionAdjustmentJsonData(layer);
  if (!isMotionAdjustmentStableId(layerId)) {
    throw new Error('Invalid motion adjustment layer id');
  }
  return layer;
}

function admitInputs(
  stack: MotionAdjustmentStackContract,
  input: object,
): void {
  assertMotionAdjustmentJsonData(stack);
  assertMotionAdjustmentJsonData(input);
  if (!isPlainRecord(input)) {
    throw new Error('Invalid motion adjustment mutation input');
  }
  planMotionAdjustmentOperations(stack);
  const expectedRevision = input.expectedRevision;
  assertMotionAdjustmentRevision(expectedRevision);
  if (stack.revision !== expectedRevision) {
    throw new Error('Motion adjustment stack revision conflict');
  }
  if (stack.revision > Number.MAX_SAFE_INTEGER - 2) {
    throw new Error('Motion adjustment stack revision cannot advance safely');
  }
}

function buildMutationPlan(
  kind: MotionAdjustmentMutationKind,
  previousStack: MotionAdjustmentStackContract,
  nextLayers: MotionAdjustmentStackLayerContract[],
  layerId: string,
  beforeIndex: number | null,
  afterIndex: number | null,
): MotionAdjustmentMutationPlan {
  const applyRevision = previousStack.revision + 1;
  const undoRevision = previousStack.revision + 2;
  const applyStack = cloneStack(previousStack, nextLayers, applyRevision);
  const undoStack = cloneStack(
    previousStack,
    cloneLayers(previousStack.layers),
    undoRevision,
  );
  planMotionAdjustmentOperations(applyStack);
  planMotionAdjustmentOperations(undoStack);

  return {
    contractVersion: MOTION_ADJUSTMENT_MUTATION_PLAN_VERSION,
    kind,
    layerId,
    ordering: {
      inputOrder: 'top-to-bottom',
      beforeIndex,
      afterIndex,
      beforeLowerLayerIds: collectLowerLayerIds(previousStack.layers, beforeIndex),
      afterLowerLayerIds: collectLowerLayerIds(nextLayers, afterIndex),
    },
    apply: {
      expectedRevision: previousStack.revision,
      nextRevision: applyRevision,
      stack: applyStack,
    },
    undo: {
      expectedRevision: applyRevision,
      nextRevision: undoRevision,
      stack: undoStack,
    },
    history: {
      mode: 'single-entry',
      atomic: true,
      label: `${capitalize(kind)} Adjustment Layer`,
    },
  };
}

function assertCandidateLayers(
  stack: MotionAdjustmentStackContract,
  layers: MotionAdjustmentStackLayerContract[],
): void {
  planMotionAdjustmentOperations({
    ...stack,
    layers,
  });
}

function requireAdjustmentIndex(
  stack: MotionAdjustmentStackContract,
  layerId: string,
): number {
  const index = stack.layers.findIndex((layer) => layer.layerId === layerId);
  if (index < 0 || stack.layers[index]?.kind !== 'adjustment') {
    throw new Error(`Unknown motion adjustment layer: ${layerId}`);
  }
  return index;
}

function collectLowerLayerIds(
  layers: readonly MotionAdjustmentStackLayerContract[],
  layerIndex: number | null,
): string[] {
  return layerIndex === null
    ? []
    : layers.slice(layerIndex + 1).map((layer) => layer.layerId);
}

function cloneStack(
  stack: MotionAdjustmentStackContract,
  layers: MotionAdjustmentStackLayerContract[],
  revision: number,
): MotionAdjustmentStackContract {
  return {
    contractVersion: stack.contractVersion,
    revision,
    compositionId: stack.compositionId,
    evaluationTime: stack.evaluationTime,
    inputOrder: stack.inputOrder,
    layers,
  };
}

function cloneLayers(
  layers: readonly MotionAdjustmentStackLayerContract[],
): MotionAdjustmentStackLayerContract[] {
  return layers.map((layer) => layer.kind === 'adjustment'
    ? cloneAdjustmentLayer(layer)
    : {
        kind: 'source',
        layerId: layer.layerId,
        enabled: layer.enabled,
        activeRange: { ...layer.activeRange },
        source: { ...layer.source },
        mix: cloneMix(layer.mix),
      });
}

function cloneAdjustmentLayer(
  layer: MotionAdjustmentLayerContract,
): MotionAdjustmentLayerContract {
  return {
    kind: 'adjustment',
    layerId: layer.layerId,
    enabled: layer.enabled,
    activeRange: { ...layer.activeRange },
    transform: { ...layer.transform },
    mix: cloneMix(layer.mix),
    effects: layer.effects.map(cloneEffect),
  };
}

function cloneEffect(
  effect: MotionAdjustmentEffectContract,
): MotionAdjustmentEffectContract {
  return {
    id: effect.id,
    effectType: effect.effectType,
    enabled: effect.enabled,
    parameters: { ...effect.parameters },
  };
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

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
