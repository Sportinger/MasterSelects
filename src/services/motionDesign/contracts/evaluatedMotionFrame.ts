import type { MotionExpressionResolvedValue } from '../expressions/contracts';
import {
  MOTION_MEDIA_POOL_PLAN_VERSION,
  type MotionMediaEvaluationRequest,
  type MotionMediaFrameEvaluation,
  type MotionMediaResourcePoolPlan,
} from '../media/contracts';
import {
  assertMotionMediaFrameEvaluation,
  evaluateMotionMediaFrame,
} from '../media/evaluationPlanner';
import { planMotionMediaResourcePools } from '../media/resourcePoolPlanner';
import type { MotionModifierStackContractV1 } from '../modifiers/contracts';
import {
  planMotionModifiers,
  type MotionModifierPlanContext,
  type SuccessfulMotionModifierPlan,
} from '../modifiers/referencePlanner';
import {
  MOTION_REPLICATOR_CONTRACT_VERSION,
  migrateMotionReplicatorContract,
  type EvaluatedReplicatorTransform,
  type MotionReplicatorContractV2,
  type ReplicatorBounds,
  type ReplicatorRuntimeLimits,
  type SuccessfulReplicatorEvaluation,
} from '../replicator/contracts';
import {
  composeReplicatorTransforms,
  evaluateMotionReplicatorReference,
  validateReplicatorBounds,
} from '../replicator/referenceEvaluator';
import type {
  MotionParentGraphEvaluation,
  MotionParentGraphSnapshot,
  MotionParentTransform2D,
} from '../structure/contracts';
import {
  evaluateMotionParentGraphWorldTransforms,
  validateMotionParentGraph,
} from '../structure/parentGraphPlanner';
import {
  MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION,
  assertMotionAdjustmentOperationPacket,
  type MotionAdjustmentOperationPacket,
  type MotionAdjustmentStackContract,
} from '../adjustment/contracts';
import { planMotionAdjustmentOperations } from '../adjustment/operationPlanner';
import {
  MOTION_SHARED_CONTRACT_LIMITS,
  assertMotionCapabilityDescriptor,
  assertMotionLimitDescriptor,
  assertMotionStableDiagnostic,
  type MotionCapabilityDescriptor,
  type MotionEntityRevision,
  type MotionLimitDescriptor,
  type MotionStableDiagnostic,
} from './envelopes';

export const MOTION_FRAME_STATE_VERSION = 'motion-frame-state/v1' as const;

export const MOTION_FRAME_STATE_CONSUMERS = Object.freeze([
  'preview',
  'nested-preview',
  'target-preview',
  'export',
] as const);

export const MOTION_FRAME_STATE_LIMITS = Object.freeze({
  maxLayerEntries: 10_000,
  maxTotalReplicatorInstances: 100_000,
  maxMediaEvaluations: 10_000,
  maxExpressionValues: 100_000,
  /** Covers 100k MD3/MD4 instances plus the legal one-million-application work cap. */
  maxJsonNodes: 50_000_000,
  maxJsonDepth: 64,
  maxStringLength: 65_536,
});

export type MotionFrameStateConsumer = (typeof MOTION_FRAME_STATE_CONSUMERS)[number];

export interface MotionFrameReplicatorState {
  readonly layerId: string;
  readonly contract: MotionReplicatorContractV2;
  readonly runtimeLimits: ReplicatorRuntimeLimits;
  readonly sourceBounds: ReplicatorBounds;
  readonly evaluation: SuccessfulReplicatorEvaluation;
}

export interface MotionFrameModifierState {
  readonly layerId: string;
  readonly contract: MotionModifierStackContractV1;
  readonly context: MotionModifierPlanContext;
  readonly plan: SuccessfulMotionModifierPlan;
}

export interface MotionFrameStructureInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly evaluation: MotionParentGraphEvaluation;
}

export interface MotionFrameWorldTransform {
  readonly clipId: string;
  readonly transform: MotionParentTransform2D;
}

export interface MotionFrameStructureState extends MotionFrameStructureInput {
  /** Canonical clip-id order; Maps and runtime graph objects are forbidden. */
  readonly worldTransforms: readonly MotionFrameWorldTransform[];
}

export interface MotionFrameMediaEntry {
  readonly layerId: string;
  readonly request: MotionMediaEvaluationRequest;
  readonly evaluation: MotionMediaFrameEvaluation;
}

export interface MotionFrameMediaState {
  readonly entries: readonly MotionFrameMediaEntry[];
  readonly poolPlan: MotionMediaResourcePoolPlan;
}

export interface MotionFrameExpressionValue {
  readonly entityId: string;
  readonly propertyPath: string;
  readonly contractRevision: string;
  readonly clipLocalTimeSeconds: number;
  readonly instanceIndex: number;
  readonly effectiveCount: number;
  readonly resolved: MotionExpressionResolvedValue;
}

export interface MotionFrameAdjustmentState {
  readonly stack: MotionAdjustmentStackContract;
  readonly packet: MotionAdjustmentOperationPacket;
}

export interface MotionFrameState {
  readonly contractVersion: typeof MOTION_FRAME_STATE_VERSION;
  readonly frameId: string;
  readonly compositionId: string;
  /** The aggregate time basis is timeline seconds; leaf clip-local times remain explicit. */
  readonly timelineTimeSeconds: number;
  readonly evaluationRevision: string;
  readonly capabilities: readonly MotionCapabilityDescriptor[];
  readonly limits: readonly MotionLimitDescriptor[];
  readonly entityRevisions: readonly MotionEntityRevision[];
  readonly replicators: readonly MotionFrameReplicatorState[];
  readonly modifiers: readonly MotionFrameModifierState[];
  readonly structure: MotionFrameStructureState | null;
  readonly adjustment: MotionFrameAdjustmentState | null;
  readonly media: MotionFrameMediaState;
  readonly expressions: readonly MotionFrameExpressionValue[];
  readonly diagnostics: readonly MotionStableDiagnostic[];
}

export interface MotionFrameStateBuildInput {
  readonly frameId: string;
  readonly compositionId: string;
  readonly timelineTimeSeconds: number;
  readonly evaluationRevision: string;
  readonly capabilities: readonly MotionCapabilityDescriptor[];
  readonly limits: readonly MotionLimitDescriptor[];
  readonly entityRevisions: readonly MotionEntityRevision[];
  readonly replicators: readonly MotionFrameReplicatorState[];
  readonly modifiers: readonly MotionFrameModifierState[];
  readonly structure: MotionFrameStructureInput | null;
  readonly adjustment: MotionFrameAdjustmentState | null;
  readonly mediaEntries: readonly MotionFrameMediaEntry[];
  readonly expressions: readonly MotionFrameExpressionValue[];
  readonly diagnostics: readonly MotionStableDiagnostic[];
}

export interface MotionFrameStateFailure {
  readonly code: 'MOTION_FRAME_STATE_INVALID';
  readonly message: string;
}

export type MotionFrameStateResult =
  | { readonly ok: true; readonly state: MotionFrameState; readonly failures: readonly [] }
  | { readonly ok: false; readonly state: null; readonly failures: readonly MotionFrameStateFailure[] };

export interface MotionFrameConsumerInput {
  readonly consumer: MotionFrameStateConsumer;
  readonly frameState: MotionFrameState;
}

/** Runtime-only admission brand; it never enters the serializable frame packet. */
const admittedMotionFrameStates = new WeakSet<object>();

type UnknownRecord = Record<string, unknown>;

const FORBIDDEN_RUNTIME_FIELDS = new Set([
  'runtimehandle',
  'renderingcontext',
  'gputexture',
  'videoframe',
  'decoder',
  'filehandle',
  'localpath',
  'objecturl',
]);

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is UnknownRecord {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => keys.includes(key))
    && keys.every((key) => allowed.has(key));
}

function isStableString(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\u0000')
    && value.length <= MOTION_SHARED_CONTRACT_LIMITS.maxStableIdLength;
}

function assertDenseBoundedArray(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be a bounded dense array`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} requires the standard Array prototype`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new Error(`${label} must not contain holes`);
    }
  }
}

/** Iterative descriptor walk: large 100k-instance packets cannot overflow the stack. */
function assertRuntimeFreeFrameTree(root: unknown): void {
  const active = new Set<object>();
  const pending: Array<{
    value: unknown;
    path: string;
    depth: number;
    exit?: object;
  }> = [{
    value: root,
    path: '$',
    depth: 0,
  }];
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.exit) {
      active.delete(current.exit);
      continue;
    }
    nodeCount += 1;
    if (
      nodeCount > MOTION_FRAME_STATE_LIMITS.maxJsonNodes
      || current.depth > MOTION_FRAME_STATE_LIMITS.maxJsonDepth
    ) {
      throw new Error('Motion frame state exceeds its JSON node or depth budget');
    }
    const value = current.value;
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Non-finite Motion frame value at ${current.path}`);
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MOTION_FRAME_STATE_LIMITS.maxStringLength) {
        throw new Error(`Motion frame string budget exceeded at ${current.path}`);
      }
      if (/^data:[^,]+;base64,/i.test(value)) {
        throw new Error(`Embedded binary data is forbidden at ${current.path}`);
      }
      continue;
    }
    if (typeof value !== 'object' || value === undefined) {
      throw new Error(`Motion frame state is not JSON-safe at ${current.path}`);
    }
    if (active.has(value)) {
      throw new Error(`Motion frame state contains a cycle at ${current.path}`);
    }
    active.add(value);
    pending.push({
      value: null,
      path: current.path,
      depth: current.depth,
      exit: value,
    });
    if (!Array.isArray(value) && !isPlainRecord(value)) {
      throw new Error(`Motion frame state contains a runtime object at ${current.path}`);
    }
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`Motion frame state contains a custom Array prototype at ${current.path}`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`Motion frame state contains a symbol at ${current.path}`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => (
        typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      ))) {
        throw new Error(`Motion frame array contains a custom property at ${current.path}`);
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new Error(`Motion frame array contains a hole or accessor at ${current.path}`);
        }
        pending.push({
          value: descriptor.value,
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`Motion frame object contains an accessor at ${current.path}.${key}`);
      }
      if (FORBIDDEN_RUNTIME_FIELDS.has(key.toLowerCase())) {
        throw new Error(`Motion frame runtime field is forbidden at ${current.path}.${key}`);
      }
      pending.push({
        value: descriptor.value,
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
}

function deepFreezeMotionFrameState(state: MotionFrameState): MotionFrameState {
  const pending: object[] = [state];
  const frozen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (frozen.has(current)) continue;
    frozen.add(current);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (!('value' in descriptor)) continue;
      const child = descriptor.value;
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
    Object.freeze(current);
  }
  return state;
}

function assertEntityRevision(value: unknown): asserts value is MotionEntityRevision {
  if (
    !hasExactKeys(value, ['kind', 'entityId', 'revision'])
    || !isStableString(value.kind)
    || !isStableString(value.entityId)
    || !isStableString(value.revision)
  ) {
    throw new Error('Motion frame entity revisions are invalid');
  }
}

function assertTransform(value: unknown): asserts value is EvaluatedReplicatorTransform {
  if (
    !hasExactKeys(value, ['position', 'rotationDegrees', 'scale', 'opacity'])
    || !hasExactKeys(value.position, ['x', 'y'])
    || !hasExactKeys(value.scale, ['x', 'y'])
  ) {
    throw new Error('Motion frame Replicator transform is malformed');
  }
  const numbers = [
    value.position.x,
    value.position.y,
    value.rotationDegrees,
    value.scale.x,
    value.scale.y,
    value.opacity,
  ];
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error('Motion frame Replicator transform must be finite');
  }
  if (Number(value.opacity) < 0 || Number(value.opacity) > 1) {
    throw new Error('Motion frame Replicator opacity must stay inside 0..1');
  }
}

function assertReplicatorState(value: unknown): asserts value is MotionFrameReplicatorState {
  if (
    !hasExactKeys(value, ['layerId', 'contract', 'runtimeLimits', 'sourceBounds', 'evaluation'])
    || !isStableString(value.layerId)
  ) {
    throw new Error('Motion frame Replicator entry is malformed');
  }
  const canonicalContract = migrateMotionReplicatorContract(value.contract);
  const canonicalBounds = validateReplicatorBounds(value.sourceBounds);
  if (
    JSON.stringify(canonicalContract) !== JSON.stringify(value.contract)
    || JSON.stringify(canonicalBounds) !== JSON.stringify(value.sourceBounds)
    || !hasExactKeys(value.runtimeLimits, [
      'deviceMaxInstances',
      'renderTargetMaxInstances',
    ])
  ) {
    throw new Error('Motion frame Replicator provenance must use exact canonical V2 inputs');
  }
  const recomputed = evaluateMotionReplicatorReference(
    value.contract,
    value.runtimeLimits,
    value.sourceBounds,
  );
  if (!recomputed.ok || JSON.stringify(recomputed) !== JSON.stringify(value.evaluation)) {
    throw new Error('Motion frame Replicator evaluation must match its exact contract provenance');
  }
  const evaluation = value.evaluation;
  if (
    !isPlainRecord(evaluation)
    || evaluation.ok !== true
    || evaluation.contractVersion !== MOTION_REPLICATOR_CONTRACT_VERSION
    || !Number.isInteger(evaluation.requestedCount)
    || !Number.isInteger(evaluation.effectiveCount)
    || Number(evaluation.requestedCount) < Number(evaluation.effectiveCount)
    || Number(evaluation.effectiveCount) < 0
    || !Array.isArray(evaluation.instances)
    || evaluation.instances.length !== evaluation.effectiveCount
  ) {
    throw new Error('Motion frame accepts only successful aligned Replicator evaluations');
  }
  for (let index = 0; index < evaluation.instances.length; index += 1) {
    const instance = evaluation.instances[index] as UnknownRecord;
    if (!isPlainRecord(instance) || instance.index !== index) {
      throw new Error('Motion frame Replicator stable indexes must match array positions');
    }
    assertTransform(instance.layoutTransform);
    assertTransform(instance.offsetTransform);
    assertTransform(instance.transform);
    if (JSON.stringify(instance.transform) !== JSON.stringify(composeReplicatorTransforms(
      instance.layoutTransform,
      instance.offsetTransform,
    ))) {
      throw new Error('Motion frame Replicator final transform must match layout plus offset');
    }
  }
}

function assertModifierState(value: unknown): asserts value is MotionFrameModifierState {
  if (
    !hasExactKeys(value, ['layerId', 'contract', 'context', 'plan'])
    || !isStableString(value.layerId)
  ) {
    throw new Error('Motion frame modifier entry is malformed');
  }
  const recomputed = planMotionModifiers(value.contract, value.context);
  if (!recomputed.ok || JSON.stringify(recomputed) !== JSON.stringify(value.plan)) {
    throw new Error('Motion frame modifier plan must match its exact contract and time provenance');
  }
  const plan = value.plan;
  if (
    !isPlainRecord(plan)
    || plan.ok !== true
    || plan.timeBasis !== 'clip-local-seconds'
    || !Number.isInteger(plan.requestedCount)
    || !Number.isInteger(plan.effectiveCount)
    || Number(plan.requestedCount) < Number(plan.effectiveCount)
    || Number(plan.effectiveCount) < 0
    || !Array.isArray(plan.instances)
    || plan.instances.length !== plan.effectiveCount
  ) {
    throw new Error('Motion frame accepts only successful aligned modifier plans');
  }
  for (let index = 0; index < plan.instances.length; index += 1) {
    const instance = plan.instances[index] as UnknownRecord;
    if (!isPlainRecord(instance) || instance.index !== index) {
      throw new Error('Motion frame modifier stable indexes must match array positions');
    }
    assertTransform(instance.layoutTransform);
    assertTransform(instance.offsetTransform);
    assertTransform(instance.transform);
    if (JSON.stringify(instance.transform) !== JSON.stringify(composeReplicatorTransforms(
      instance.layoutTransform,
      instance.offsetTransform,
    ))) {
      throw new Error('Motion frame modifier final transform must match layout plus modified offset');
    }
  }
}

function assertExpressionValue(value: unknown): asserts value is MotionFrameExpressionValue {
  if (
    !hasExactKeys(value, [
      'entityId',
      'propertyPath',
      'contractRevision',
      'clipLocalTimeSeconds',
      'instanceIndex',
      'effectiveCount',
      'resolved',
    ])
    || !isStableString(value.entityId)
    || !isStableString(value.propertyPath)
    || !isStableString(value.contractRevision)
    || typeof value.clipLocalTimeSeconds !== 'number'
    || !Number.isFinite(value.clipLocalTimeSeconds)
    || !Number.isInteger(value.instanceIndex)
    || Number(value.instanceIndex) < 0
    || !Number.isInteger(value.effectiveCount)
    || Number(value.effectiveCount) < 1
    || Number(value.instanceIndex) >= Number(value.effectiveCount)
    || !hasExactKeys(value.resolved, ['value', 'source', 'precedence'])
    || typeof value.resolved.value !== 'number'
    || !Number.isFinite(value.resolved.value)
    || !['expression', 'keyframe', 'base'].includes(String(value.resolved.source))
    || value.resolved.precedence !== 'expression-over-keyframe'
  ) {
    throw new Error('Motion frame expression value is invalid');
  }
}

function assertUniqueBy(
  values: readonly unknown[],
  keyOf: (value: unknown) => string,
  label: string,
): void {
  const keys = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (keys.has(key)) throw new Error(`${label} must contain unique stable ids`);
    keys.add(key);
  }
}

function compareStableString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertCanonicalOrder<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) > 0) {
      throw new Error(`${label} must use canonical order`);
    }
  }
}

function assertSharedFrameFields(value: UnknownRecord): void {
  if (
    value.contractVersion !== MOTION_FRAME_STATE_VERSION
    || !isStableString(value.frameId)
    || !isStableString(value.compositionId)
    || typeof value.timelineTimeSeconds !== 'number'
    || !Number.isFinite(value.timelineTimeSeconds)
    || !isStableString(value.evaluationRevision)
  ) {
    throw new Error('Motion frame identity or timeline values are invalid');
  }
  assertDenseBoundedArray(
    value.capabilities,
    'Motion frame capabilities',
    MOTION_SHARED_CONTRACT_LIMITS.maxCapabilities,
  );
  assertDenseBoundedArray(value.limits, 'Motion frame limits', MOTION_SHARED_CONTRACT_LIMITS.maxLimits);
  assertDenseBoundedArray(
    value.entityRevisions,
    'Motion frame entity revisions',
    MOTION_SHARED_CONTRACT_LIMITS.maxEntityRevisions,
  );
  assertDenseBoundedArray(
    value.diagnostics,
    'Motion frame diagnostics',
    MOTION_SHARED_CONTRACT_LIMITS.maxDiagnostics,
  );
  value.capabilities.forEach(assertMotionCapabilityDescriptor);
  value.limits.forEach(assertMotionLimitDescriptor);
  value.entityRevisions.forEach(assertEntityRevision);
  value.diagnostics.forEach(assertMotionStableDiagnostic);
  assertUniqueBy(value.capabilities, (entry) => (entry as MotionCapabilityDescriptor).id, 'Capabilities');
  assertUniqueBy(value.limits, (entry) => (entry as MotionLimitDescriptor).id, 'Limits');
  assertUniqueBy(
    value.entityRevisions,
    (entry) => `${(entry as MotionEntityRevision).kind}\u0000${(entry as MotionEntityRevision).entityId}`,
    'Entity revisions',
  );
  assertCanonicalOrder(
    value.capabilities as unknown as MotionCapabilityDescriptor[],
    (left, right) => compareStableString(left.id, right.id),
    'Capabilities',
  );
  assertCanonicalOrder(
    value.limits as unknown as MotionLimitDescriptor[],
    (left, right) => compareStableString(left.id, right.id),
    'Limits',
  );
  assertCanonicalOrder(
    value.entityRevisions as unknown as MotionEntityRevision[],
    (left, right) => compareStableString(
      `${left.kind}\u0000${left.entityId}`,
      `${right.kind}\u0000${right.entityId}`,
    ),
    'Entity revisions',
  );
}

function assertFrameLeafState(value: UnknownRecord): void {
  assertDenseBoundedArray(value.replicators, 'Motion frame Replicators', MOTION_FRAME_STATE_LIMITS.maxLayerEntries);
  assertDenseBoundedArray(value.modifiers, 'Motion frame modifiers', MOTION_FRAME_STATE_LIMITS.maxLayerEntries);
  assertDenseBoundedArray(value.expressions, 'Motion frame expressions', MOTION_FRAME_STATE_LIMITS.maxExpressionValues);
  value.replicators.forEach(assertReplicatorState);
  value.modifiers.forEach(assertModifierState);
  value.expressions.forEach(assertExpressionValue);
  assertUniqueBy(value.replicators, (entry) => (entry as MotionFrameReplicatorState).layerId, 'Replicators');
  assertUniqueBy(value.modifiers, (entry) => (entry as MotionFrameModifierState).layerId, 'Modifiers');
  assertUniqueBy(
    value.expressions,
    (entry) => {
      const expression = entry as MotionFrameExpressionValue;
      return `${expression.entityId}\u0000${expression.propertyPath}\u0000${expression.instanceIndex}`;
    },
    'Expression values',
  );
  assertCanonicalOrder(
    value.replicators as unknown as MotionFrameReplicatorState[],
    (left, right) => compareStableString(left.layerId, right.layerId),
    'Replicators',
  );
  assertCanonicalOrder(
    value.modifiers as unknown as MotionFrameModifierState[],
    (left, right) => compareStableString(left.layerId, right.layerId),
    'Modifiers',
  );
  assertCanonicalOrder(
    value.expressions as unknown as MotionFrameExpressionValue[],
    (left, right) => (
      compareStableString(left.entityId, right.entityId)
      || compareStableString(left.propertyPath, right.propertyPath)
      || left.instanceIndex - right.instanceIndex
    ),
    'Expression values',
  );

  const totalReplicatorInstances = (value.replicators as unknown as MotionFrameReplicatorState[]).reduce(
    (total, entry) => total + entry.evaluation.effectiveCount,
    0,
  );
  if (totalReplicatorInstances > MOTION_FRAME_STATE_LIMITS.maxTotalReplicatorInstances) {
    throw new Error('Motion frame total Replicator instance budget exceeded');
  }
  const replicatorsByLayer = new Map(
    value.replicators.map((entry) => {
      const state = entry as MotionFrameReplicatorState;
      return [state.layerId, state.evaluation] as const;
    }),
  );
  const entityRevisionKeys = new Set(
    (value.entityRevisions as unknown as MotionEntityRevision[]).map(
      (revision) => `${revision.kind}\u0000${revision.entityId}`,
    ),
  );
  for (const entry of value.replicators as unknown as MotionFrameReplicatorState[]) {
    if (!entityRevisionKeys.has(`replicator\u0000${entry.layerId}`)) {
      throw new Error('Motion Replicators require an exact aggregate entity revision');
    }
  }
  for (const entry of value.modifiers as unknown as MotionFrameModifierState[]) {
    const replicator = replicatorsByLayer.get(entry.layerId);
    if (
      !replicator
      || replicator.requestedCount !== entry.plan.requestedCount
      || replicator.effectiveCount !== entry.plan.effectiveCount
    ) {
      throw new Error('Motion modifier plans must align with a Replicator evaluation');
    }
    if (!entityRevisionKeys.has(`modifier-stack\u0000${entry.layerId}`)) {
      throw new Error('Motion modifiers require an exact aggregate entity revision');
    }
    for (let index = 0; index < entry.plan.instances.length; index += 1) {
      if (
        JSON.stringify(entry.context.instances[index]?.layoutTransform)
          !== JSON.stringify(replicator.instances[index].layoutTransform)
        || JSON.stringify(entry.context.instances[index]?.offsetTransform)
          !== JSON.stringify(replicator.instances[index].offsetTransform)
      ) {
        throw new Error('Motion modifier provenance must start from the exact Replicator instance');
      }
      if (JSON.stringify(entry.plan.instances[index].layoutTransform)
        !== JSON.stringify(replicator.instances[index].layoutTransform)) {
        throw new Error('Motion modifier plans must preserve the Replicator layout contribution');
      }
    }
  }
  const modifiersByLayer = new Map(
    (value.modifiers as unknown as MotionFrameModifierState[]).map(
      (entry) => [entry.layerId, entry] as const,
    ),
  );
  const revisionsByEntity = new Map(
    (value.entityRevisions as unknown as MotionEntityRevision[]).map(
      (revision) => [`${revision.kind}\u0000${revision.entityId}`, revision.revision] as const,
    ),
  );
  for (const entry of value.replicators as unknown as MotionFrameReplicatorState[]) {
    if (
      revisionsByEntity.get(`replicator\u0000${entry.layerId}`)
        !== `replicator:${entry.contract.revision}`
    ) {
      throw new Error('Motion Replicator aggregate revision must match its contract revision');
    }
  }
  for (const entry of value.modifiers as unknown as MotionFrameModifierState[]) {
    if (
      revisionsByEntity.get(`modifier-stack\u0000${entry.layerId}`)
        !== `modifier:${entry.contract.revision}`
    ) {
      throw new Error('Motion modifier aggregate revision must match its contract revision');
    }
  }
  for (const expression of value.expressions as unknown as MotionFrameExpressionValue[]) {
    const entityRevision = revisionsByEntity.get(`layer\u0000${expression.entityId}`);
    if (!entityRevision || entityRevision !== expression.contractRevision) {
      throw new Error('Motion expression values require the exact aggregate entity revision');
    }
    const replicator = replicatorsByLayer.get(expression.entityId);
    if (replicator) {
      if (
        expression.effectiveCount !== replicator.effectiveCount
        || expression.instanceIndex >= replicator.effectiveCount
      ) {
        throw new Error('Motion expression index/count provenance must match its Replicator');
      }
    } else if (expression.effectiveCount !== 1 || expression.instanceIndex !== 0) {
      throw new Error('Non-replicated Motion expression values require index 0 and count 1');
    }
    const modifier = modifiersByLayer.get(expression.entityId);
    if (
      modifier
      && expression.clipLocalTimeSeconds
        !== modifier.plan.timeTicks / modifier.contract.ticksPerSecond
    ) {
      throw new Error('Motion expression and modifier values require one canonical clip-local time');
    }
  }
  const expressionIndexesBySeries = new Map<string, {
    indexes: number[];
    effectiveCount: number;
  }>();
  for (const expression of value.expressions as unknown as MotionFrameExpressionValue[]) {
    const key = [
      expression.entityId,
      expression.propertyPath,
      expression.contractRevision,
      expression.clipLocalTimeSeconds,
      expression.effectiveCount,
    ].join('\u0000');
    const series = expressionIndexesBySeries.get(key) ?? {
      indexes: [],
      effectiveCount: expression.effectiveCount,
    };
    series.indexes.push(expression.instanceIndex);
    expressionIndexesBySeries.set(key, series);
  }
  for (const { indexes, effectiveCount } of expressionIndexesBySeries.values()) {
    indexes.sort((left, right) => left - right);
    if (
      indexes.length !== effectiveCount
      || indexes.some((index, position) => index !== position)
    ) {
      throw new Error('Motion expression series must cover every effective instance exactly once');
    }
  }
}

function assertStructureState(
  value: unknown,
  compositionId: string,
  timelineTimeSeconds: number,
): asserts value is MotionFrameStructureState | null {
  if (value === null) return;
  if (!hasExactKeys(value, ['graph', 'evaluation', 'worldTransforms'])) {
    throw new Error('Motion frame structure state is malformed');
  }
  const failures = validateMotionParentGraph(value.graph as MotionParentGraphSnapshot);
  if (failures.length > 0) throw new Error(`Motion frame parent graph failed: ${failures[0].code}`);
  const graph = value.graph as MotionParentGraphSnapshot;
  if (graph.nodes.some((node) => node.compositionId !== compositionId)) {
    throw new Error('Motion frame parent graph must belong to its composition');
  }
  const evaluation = value.evaluation as MotionParentGraphEvaluation;
  if (evaluation.timelineTime !== timelineTimeSeconds) {
    throw new Error('Motion frame structure evaluation must use the aggregate timeline time');
  }
  const evaluated = evaluateMotionParentGraphWorldTransforms(graph, evaluation);
  if (!evaluated.worlds || evaluated.failures.length > 0) {
    throw new Error(`Motion frame parent evaluation failed: ${evaluated.failures[0]?.code ?? 'unknown'}`);
  }
  const expectedWorlds = [...evaluated.worlds.entries()]
    .sort(([left], [right]) => compareStableString(left, right))
    .map(([clipId, transform]) => ({ clipId, transform }));
  if (JSON.stringify(value.worldTransforms) !== JSON.stringify(expectedWorlds)) {
    throw new Error('Motion frame world transforms must match the canonical parent evaluation');
  }
}

function assertAdjustmentState(
  value: unknown,
  compositionId: string,
  timelineTimeSeconds: number,
  entityRevisions: readonly MotionEntityRevision[],
): asserts value is MotionFrameAdjustmentState | null {
  if (value === null) return;
  if (!hasExactKeys(value, ['stack', 'packet'])) {
    throw new Error('Motion adjustment aggregate requires exact stack and packet provenance');
  }
  const stack = value.stack as MotionAdjustmentStackContract;
  const packet = value.packet as MotionAdjustmentOperationPacket;
  assertMotionAdjustmentOperationPacket(packet);
  const recomputed = planMotionAdjustmentOperations(stack);
  if (
    packet.contractVersion !== MOTION_ADJUSTMENT_OPERATION_PACKET_VERSION
    || packet.compositionId !== compositionId
    || packet.evaluationTime !== timelineTimeSeconds
    || stack.compositionId !== compositionId
    || stack.evaluationTime !== timelineTimeSeconds
    || packet.revision !== stack.revision
    || JSON.stringify(recomputed) !== JSON.stringify(packet)
  ) {
    throw new Error('Motion adjustment packet must match its exact stack, revision, composition, and time');
  }
  const revisionKeys = new Map(
    entityRevisions.map((revision) => [
      `${revision.kind}\u0000${revision.entityId}`,
      revision.revision,
    ] as const),
  );
  if (
    revisionKeys.get(`adjustment-stack\u0000${compositionId}`)
      !== `adjustment:${packet.revision}`
  ) {
    throw new Error('Motion adjustment packet requires an exact aggregate stack revision');
  }
  for (const layer of stack.layers) {
    if (
      revisionKeys.get(`adjustment-layer\u0000${layer.layerId}`)
        !== `adjustment:${stack.revision}:${layer.layerId}`
    ) {
      throw new Error('Every Motion adjustment layer requires its exact stack revision');
    }
  }
}

function assertMediaState(
  value: unknown,
  adjustment: MotionAdjustmentOperationPacket | null,
  entityRevisions: readonly MotionEntityRevision[],
  replicators: readonly MotionFrameReplicatorState[],
  modifiers: readonly MotionFrameModifierState[],
  expressions: readonly MotionFrameExpressionValue[],
): asserts value is MotionFrameMediaState {
  if (!hasExactKeys(value, ['entries', 'poolPlan'])) {
    throw new Error('Motion frame media state is malformed');
  }
  assertDenseBoundedArray(
    value.entries,
    'Motion frame media entries',
    MOTION_FRAME_STATE_LIMITS.maxMediaEvaluations,
  );
  const entries = value.entries as unknown as MotionFrameMediaEntry[];
  for (const entry of entries) {
    if (
      !hasExactKeys(entry, ['layerId', 'request', 'evaluation'])
      || !isStableString(entry.layerId)
    ) {
      throw new Error('Motion frame media entry is malformed');
    }
    assertMotionMediaFrameEvaluation(entry.evaluation);
    const recomputed = evaluateMotionMediaFrame(entry.request);
    if (JSON.stringify(recomputed) !== JSON.stringify(entry.evaluation)) {
      throw new Error('Motion frame media evaluation must match its exact request provenance');
    }
  }
  assertUniqueBy(
    entries,
    (entry) => `${(entry as MotionFrameMediaEntry).layerId}\u0000${(entry as MotionFrameMediaEntry).evaluation.instanceIndex}`,
    'Motion media layer instances',
  );
  assertCanonicalOrder(
    entries,
    (left, right) => (
      compareStableString(left.layerId, right.layerId)
      || left.evaluation.instanceIndex - right.evaluation.instanceIndex
    ),
    'Motion media entries',
  );
  const mediaLayers = new Map<string, MotionFrameMediaEntry>();
  const mediaIndexesByLayer = new Map<string, number[]>();
  const entityRevisionsByKey = new Map(
    entityRevisions.map((revision) => [
      `${revision.kind}\u0000${revision.entityId}`,
      revision.revision,
    ] as const),
  );
  for (const entry of entries) {
    const expectedMediaRevision = `media:${entry.evaluation.bindingRevision ?? 'missing'}`;
    if (
      entityRevisionsByKey.get(`media-binding\u0000${entry.layerId}`)
        !== expectedMediaRevision
    ) {
      throw new Error('Motion media binding revision must match its aggregate entity revision');
    }
    const indexes = mediaIndexesByLayer.get(entry.layerId) ?? [];
    indexes.push(entry.evaluation.instanceIndex);
    mediaIndexesByLayer.set(entry.layerId, indexes);
    const first = mediaLayers.get(entry.layerId);
    if (!first) {
      mediaLayers.set(entry.layerId, entry);
      continue;
    }
    if (
      first.evaluation.sourceId !== entry.evaluation.sourceId
      || first.evaluation.sourceKind !== entry.evaluation.sourceKind
      || first.evaluation.bindingRevision !== entry.evaluation.bindingRevision
      || first.evaluation.clipLocalTimeSeconds !== entry.evaluation.clipLocalTimeSeconds
    ) {
      throw new Error('Motion media instances on one layer require identical source provenance');
    }
  }
  const replicatorsByLayer = new Map(
    replicators.map((entry) => [entry.layerId, entry.evaluation] as const),
  );
  const canonicalTimesByLayer = new Map<string, number>();
  for (const modifier of modifiers) {
    canonicalTimesByLayer.set(
      modifier.layerId,
      modifier.plan.timeTicks / modifier.contract.ticksPerSecond,
    );
  }
  for (const expression of expressions) {
    const existing = canonicalTimesByLayer.get(expression.entityId);
    if (existing !== undefined && existing !== expression.clipLocalTimeSeconds) {
      throw new Error('Motion frame leaf domains disagree on canonical clip-local time');
    }
    canonicalTimesByLayer.set(expression.entityId, expression.clipLocalTimeSeconds);
  }
  for (const [layerId, indexes] of mediaIndexesByLayer) {
    indexes.sort((left, right) => left - right);
    const replicator = replicatorsByLayer.get(layerId);
    if (replicator) {
      if (
        indexes.length !== replicator.effectiveCount
        || indexes.some((index, position) => index !== position)
      ) {
        throw new Error('Replicated Motion media must cover every effective stable index exactly once');
      }
    } else if (indexes.length !== 1 || indexes[0] !== 0) {
      throw new Error('Non-replicated Motion media requires exactly stable index 0');
    }
    const mediaTime = mediaLayers.get(layerId)!.evaluation.clipLocalTimeSeconds;
    const canonicalTime = canonicalTimesByLayer.get(layerId);
    if (canonicalTime !== undefined && canonicalTime !== mediaTime) {
      throw new Error('Motion media must use the layer canonical clip-local time');
    }
  }
  const expectedPool = planMotionMediaResourcePools(entries.map((entry) => entry.evaluation));
  const poolPlan = value.poolPlan as MotionMediaResourcePoolPlan;
  if (
    poolPlan.contractVersion !== MOTION_MEDIA_POOL_PLAN_VERSION
    || JSON.stringify(poolPlan) !== JSON.stringify(expectedPool)
  ) {
    throw new Error('Motion frame media pool plan must be canonical for its evaluations');
  }

  const motionMediaLayerSources = new Set(
    entries.map((entry) => `${entry.layerId}\u0000${entry.evaluation.sourceId}`),
  );
  for (const operation of adjustment?.operations ?? []) {
    if (
      operation.type === 'resolve-source'
      && operation.sourceKind === 'motion-media'
      && !motionMediaLayerSources.has(`${operation.layerId}\u0000${operation.sourceId}`)
    ) {
      throw new Error('Motion adjustment sources require a matching layer-bound media evaluation');
    }
  }
}

export function assertMotionFrameState(value: unknown): asserts value is MotionFrameState {
  assertRuntimeFreeFrameTree(value);
  if (!hasExactKeys(value, [
    'contractVersion',
    'frameId',
    'compositionId',
    'timelineTimeSeconds',
    'evaluationRevision',
    'capabilities',
    'limits',
    'entityRevisions',
    'replicators',
    'modifiers',
    'structure',
    'adjustment',
    'media',
    'expressions',
    'diagnostics',
  ])) {
    throw new Error('Motion frame state requires an exact inert envelope');
  }
  assertSharedFrameFields(value);
  assertFrameLeafState(value);
  assertStructureState(value.structure, value.compositionId as string, value.timelineTimeSeconds as number);
  assertAdjustmentState(
    value.adjustment,
    value.compositionId as string,
    value.timelineTimeSeconds as number,
    value.entityRevisions as unknown as MotionEntityRevision[],
  );
  assertMediaState(
    value.media,
    (value.adjustment as MotionFrameAdjustmentState | null)?.packet ?? null,
    value.entityRevisions as unknown as MotionEntityRevision[],
    value.replicators as unknown as MotionFrameReplicatorState[],
    value.modifiers as unknown as MotionFrameModifierState[],
    value.expressions as unknown as MotionFrameExpressionValue[],
  );
}

export function createMotionFrameState(input: MotionFrameStateBuildInput): MotionFrameStateResult {
  try {
    assertRuntimeFreeFrameTree(input);
    if (!hasExactKeys(input, [
      'frameId',
      'compositionId',
      'timelineTimeSeconds',
      'evaluationRevision',
      'capabilities',
      'limits',
      'entityRevisions',
      'replicators',
      'modifiers',
      'structure',
      'adjustment',
      'mediaEntries',
      'expressions',
      'diagnostics',
    ])) {
      throw new Error('Motion frame build input requires an exact inert envelope');
    }
    let structure: MotionFrameStructureState | null = null;
    if (input.structure) {
      const evaluated = evaluateMotionParentGraphWorldTransforms(
        input.structure.graph,
        input.structure.evaluation,
      );
      if (!evaluated.worlds || evaluated.failures.length > 0) {
        throw new Error(`Motion frame parent evaluation failed: ${evaluated.failures[0]?.code ?? 'unknown'}`);
      }
      structure = {
        graph: input.structure.graph,
        evaluation: input.structure.evaluation,
        worldTransforms: [...evaluated.worlds.entries()]
          .sort(([left], [right]) => compareStableString(left, right))
          .map(([clipId, transform]) => ({ clipId, transform })),
      };
    }
    const mediaEntries = [...input.mediaEntries].sort((left, right) => (
      compareStableString(left.layerId, right.layerId)
      || left.evaluation.instanceIndex - right.evaluation.instanceIndex
    ));
    const candidate: MotionFrameState = {
      contractVersion: MOTION_FRAME_STATE_VERSION,
      frameId: input.frameId,
      compositionId: input.compositionId,
      timelineTimeSeconds: input.timelineTimeSeconds,
      evaluationRevision: input.evaluationRevision,
      capabilities: [...input.capabilities].sort((left, right) => compareStableString(left.id, right.id)),
      limits: [...input.limits].sort((left, right) => compareStableString(left.id, right.id)),
      entityRevisions: [...input.entityRevisions].sort((left, right) => (
        compareStableString(`${left.kind}\u0000${left.entityId}`, `${right.kind}\u0000${right.entityId}`)
      )),
      replicators: [...input.replicators].sort((left, right) => compareStableString(left.layerId, right.layerId)),
      modifiers: [...input.modifiers].sort((left, right) => compareStableString(left.layerId, right.layerId)),
      structure,
      adjustment: input.adjustment,
      media: {
        entries: mediaEntries,
        poolPlan: planMotionMediaResourcePools(mediaEntries.map((entry) => entry.evaluation)),
      },
      expressions: [...input.expressions].sort((left, right) => (
        compareStableString(left.entityId, right.entityId)
        || compareStableString(left.propertyPath, right.propertyPath)
        || left.instanceIndex - right.instanceIndex
      )),
      diagnostics: [...input.diagnostics],
    };
    assertMotionFrameState(candidate);
    const state = deepFreezeMotionFrameState(
      JSON.parse(JSON.stringify(candidate)) as MotionFrameState,
    );
    admittedMotionFrameStates.add(state);
    return { ok: true, state, failures: [] };
  } catch (error) {
    return {
      ok: false,
      state: null,
      failures: [{
        code: 'MOTION_FRAME_STATE_INVALID',
        message: error instanceof Error ? error.message : 'Motion frame state is invalid',
      }],
    };
  }
}

export function serializeMotionFrameState(state: MotionFrameState): string {
  assertMotionFrameState(state);
  return JSON.stringify(state);
}

export function parseMotionFrameState(serialized: string): MotionFrameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Motion frame state is not valid JSON');
  }
  assertMotionFrameState(parsed);
  const state = deepFreezeMotionFrameState(parsed);
  admittedMotionFrameStates.add(state);
  return state;
}

export function bindMotionFrameStateConsumer(
  frameState: MotionFrameState,
  consumer: MotionFrameStateConsumer,
): MotionFrameConsumerInput {
  if (!admittedMotionFrameStates.has(frameState)) {
    throw new Error('Motion frame consumer input must be created or parsed at the contract boundary');
  }
  if (!MOTION_FRAME_STATE_CONSUMERS.includes(consumer)) {
    throw new Error('Unknown Motion frame-state consumer');
  }
  return { consumer, frameState };
}
