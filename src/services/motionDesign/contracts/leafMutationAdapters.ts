import type { MotionJsonObject } from '../presets/jsonSafety';
import {
  MOTION_PARENT_GRAPH_CONTRACT_VERSION,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentMutationPlan,
  type MotionParentPlanDirection,
  type MotionParentTransform2D,
} from '../structure/contracts';
import {
  planMotionParentMutation,
  validateMotionParentGraph,
  type PlanMotionParentMutationInput,
} from '../structure/parentGraphPlanner';
import { isFiniteMotionParentTransform2D } from '../structure/parentTransformMath';
import {
  MOTION_TEMPLATE_VERSION,
  type MotionTemplateInstantiateOperation,
  type MotionTemplateInstantiatePlan,
} from '../templates/contracts';
import {
  planMotionTemplateInstantiation,
  type PlanMotionTemplateInstantiationInput,
} from '../templates/instantiatePlanner';
import {
  MOTION_MUTATION_BATCH_VERSION,
  assertMotionAtomicMutationBatch,
  type MotionAtomicMutationBatch,
  type MotionMutationOperation,
} from './envelopes';

export const MOTION_LEAF_MUTATION_ADAPTER_VERSION = 'motion-leaf-mutation-adapter/v1' as const;

const MAX_ADAPTER_INPUT_NODES = 500_000;
const MAX_ADAPTER_INPUT_DEPTH = 64;
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

function assertInertJsonTree(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number; exit?: object }> = [{
    value,
    depth: 0,
  }];
  const active = new Set<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.exit) {
      active.delete(item.exit);
      continue;
    }
    const current = item.value;
    nodes += 1;
    if (nodes > MAX_ADAPTER_INPUT_NODES) {
      throw new Error('Motion leaf mutation adapter input exceeds its node budget');
    }
    if (item.depth > MAX_ADAPTER_INPUT_DEPTH) {
      throw new Error('Motion leaf mutation adapter input exceeds its depth budget');
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'string') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('Motion leaf mutation adapter rejects non-finite data');
      continue;
    }
    if (typeof current !== 'object' || current === undefined) {
      throw new Error('Motion leaf mutation adapter accepts only JSON data');
    }
    if (active.has(current)) throw new Error('Motion leaf mutation adapter rejects cycles');
    active.add(current);
    pending.push({ value: null, depth: item.depth, exit: current });
    const prototype = Object.getPrototypeOf(current);
    if (
      (Array.isArray(current) && prototype !== Array.prototype)
      || (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null)
    ) {
      throw new Error('Motion leaf mutation adapter rejects runtime objects');
    }
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new Error('Motion leaf mutation adapter rejects symbols');
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (Array.isArray(current)) {
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => (
        typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
      ))) {
        throw new Error('Motion leaf mutation adapter rejects custom array properties');
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw new Error('Motion leaf mutation adapter rejects sparse/accessor arrays');
        }
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
      continue;
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Motion leaf mutation adapter rejects accessors');
      }
      if (FORBIDDEN_RUNTIME_FIELDS.has(key.toLowerCase())) {
        throw new Error('Motion leaf mutation adapter rejects runtime fields');
      }
      pending.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const keys = Object.keys(value);
  return requiredKeys.every((key) => keys.includes(key))
    && keys.every((key) => allowed.has(key));
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\u0000')
    && value.length <= 512;
}

function assertParentDirection(direction: MotionParentPlanDirection): void {
  if (
    !hasExactKeys(direction, ['expectedRevision', 'nextRevision', 'graph', 'changes'])
    || !isStableId(direction.expectedRevision)
    || !isStableId(direction.nextRevision)
    || direction.expectedRevision === direction.nextRevision
    || direction.graph.revision !== direction.nextRevision
    || validateMotionParentGraph(direction.graph).length > 0
    || !Array.isArray(direction.changes)
    || direction.changes.length === 0
  ) {
    throw new Error('Motion parent mutation direction is invalid');
  }
  for (const change of direction.changes) {
    if (
      !hasExactKeys(
        change,
        ['clipId', 'fromLocalTransform', 'toLocalTransform'],
        ['fromParentClipId', 'toParentClipId'],
      )
      || !isStableId(change.clipId)
      || !isFiniteMotionParentTransform2D(
        change.fromLocalTransform as MotionParentTransform2D,
      )
      || !isFiniteMotionParentTransform2D(
        change.toLocalTransform as MotionParentTransform2D,
      )
    ) {
      throw new Error('Motion parent mutation change is invalid');
    }
  }
}

function assertParentMutationPlan(plan: MotionParentMutationPlan): void {
  if (
    !hasExactKeys(plan, [
      'contractVersion',
      'kind',
      'timelineTime',
      'preservation',
      'affectedClipIds',
      'childWorldTransformAtOperationTime',
      'apply',
      'undo',
      'history',
    ])
    || plan.contractVersion !== MOTION_PARENT_GRAPH_CONTRACT_VERSION
    || !['set', 'clear', 'reparent'].includes(plan.kind)
    || typeof plan.timelineTime !== 'number'
    || !Number.isFinite(plan.timelineTime)
    || plan.preservation !== MOTION_PARENT_WORLD_PRESERVATION
    || !Array.isArray(plan.affectedClipIds)
    || plan.affectedClipIds.length === 0
    || new Set(plan.affectedClipIds).size !== plan.affectedClipIds.length
    || !plan.affectedClipIds.every(isStableId)
    || !isFiniteMotionParentTransform2D(plan.childWorldTransformAtOperationTime)
    || !hasExactKeys(plan.history, ['mode', 'label', 'atomic'])
    || plan.history.mode !== 'single-entry'
    || !isStableId(plan.history.label)
    || plan.history.atomic !== true
  ) {
    throw new Error('Motion parent mutation plan is invalid');
  }
  assertParentDirection(plan.apply);
  assertParentDirection(plan.undo);
  if (
    plan.apply.expectedRevision !== plan.undo.nextRevision
    || plan.apply.nextRevision !== plan.undo.expectedRevision
    || plan.apply.changes.length !== plan.undo.changes.length
  ) {
    throw new Error('Motion parent apply and undo directions are not exact inverses');
  }
  const undoByClipId = new Map(plan.undo.changes.map((change) => [change.clipId, change]));
  for (const applyChange of plan.apply.changes) {
    const undoChange = undoByClipId.get(applyChange.clipId);
    if (
      !undoChange
      || applyChange.fromParentClipId !== undoChange.toParentClipId
      || applyChange.toParentClipId !== undoChange.fromParentClipId
      || JSON.stringify(applyChange.fromLocalTransform)
        !== JSON.stringify(undoChange.toLocalTransform)
      || JSON.stringify(applyChange.toLocalTransform)
        !== JSON.stringify(undoChange.fromLocalTransform)
    ) {
      throw new Error('Motion parent apply and undo changes are not lossless inverses');
    }
  }
}

function assertTemplateOperation(
  operation: MotionTemplateInstantiateOperation,
  createdEntityIds: Set<string>,
  relationshipPhase: boolean,
): boolean {
  if (operation.type === 'create-entity') {
    if (
      relationshipPhase
      || !hasExactKeys(operation, [
        'type',
        'targetEntityId',
        'entityKind',
        'startTime',
        'duration',
        'payload',
        'dependencyBindings',
      ])
      || !isStableId(operation.targetEntityId)
      || !isStableId(operation.entityKind)
      || !Number.isFinite(operation.startTime)
      || !Number.isFinite(operation.duration)
      || operation.duration <= 0
      || !Array.isArray(operation.dependencyBindings)
      || createdEntityIds.has(operation.targetEntityId)
    ) {
      throw new Error('Motion template create-entity operation is invalid');
    }
    for (const binding of operation.dependencyBindings) {
      if (
        !hasExactKeys(binding, ['dependencyId', 'resolvedProjectId'])
        || !isStableId(binding.dependencyId)
        || !isStableId(binding.resolvedProjectId)
      ) {
        throw new Error('Motion template dependency binding is invalid');
      }
    }
    createdEntityIds.add(operation.targetEntityId);
    return false;
  }
  if (
    !hasExactKeys(operation, [
      'type',
      'targetRelationshipId',
      'relationshipKind',
      'fromEntityId',
      'toEntityId',
      'payload',
    ])
    || !isStableId(operation.targetRelationshipId)
    || !isStableId(operation.relationshipKind)
    || !createdEntityIds.has(operation.fromEntityId as string)
    || !createdEntityIds.has(operation.toEntityId as string)
  ) {
    throw new Error('Motion template create-relationship operation is invalid');
  }
  return true;
}

function assertTemplateInstantiationPlan(plan: MotionTemplateInstantiatePlan): void {
  if (
    !hasExactKeys(plan, [
      'contractVersion',
      'templateId',
      'destinationCompositionId',
      'insertionTime',
      'idRemap',
      'dependencyInventory',
      'batch',
    ])
    || plan.contractVersion !== MOTION_TEMPLATE_VERSION
    || !isStableId(plan.templateId)
    || !isStableId(plan.destinationCompositionId)
    || !Number.isFinite(plan.insertionTime)
    || !Array.isArray(plan.idRemap)
    || !hasExactKeys(plan.dependencyInventory, [
      'complete',
      'entries',
      'missingDependencyIds',
    ])
    || plan.dependencyInventory.complete !== true
    || !Array.isArray(plan.dependencyInventory.entries)
    || !Array.isArray(plan.dependencyInventory.missingDependencyIds)
    || plan.dependencyInventory.missingDependencyIds.length !== 0
    || !hasExactKeys(plan.batch, ['batchId', 'mode', 'atomic', 'operations'])
    || !/^msm_batch_[0-9a-f]{16}$/.test(plan.batch.batchId)
    || plan.batch.mode !== 'single-undo-batch'
    || plan.batch.atomic !== true
    || !Array.isArray(plan.batch.operations)
    || plan.batch.operations.length === 0
    || plan.batch.operations.length !== plan.idRemap.length
  ) {
    throw new Error('Motion template instantiation plan is invalid');
  }
  const remapTargetIds = new Set<string>();
  for (const remap of plan.idRemap) {
    if (
      !hasExactKeys(remap, ['sourceId', 'targetId', 'kind'])
      || !isStableId(remap.sourceId)
      || !isStableId(remap.targetId)
      || (remap.kind !== 'entity' && remap.kind !== 'relationship')
      || remapTargetIds.has(remap.targetId)
    ) {
      throw new Error('Motion template id remap is invalid');
    }
    remapTargetIds.add(remap.targetId);
  }
  const createdEntityIds = new Set<string>();
  const operationTargetIds = new Set<string>();
  let relationshipPhase = false;
  for (const operation of plan.batch.operations) {
    relationshipPhase = assertTemplateOperation(
      operation,
      createdEntityIds,
      relationshipPhase,
    ) || relationshipPhase;
    const targetId = operation.type === 'create-entity'
      ? operation.targetEntityId
      : operation.targetRelationshipId;
    if (operationTargetIds.has(targetId)) {
      throw new Error('Motion template operations require unique target ids');
    }
    operationTargetIds.add(targetId);
  }
  if (
    operationTargetIds.size !== remapTargetIds.size
    || [...operationTargetIds].some((targetId) => !remapTargetIds.has(targetId))
  ) {
    throw new Error('Motion template operations must exactly cover the stable id remap');
  }
}

function templateOperationToMutation(
  operation: MotionTemplateInstantiateOperation,
): MotionMutationOperation {
  const entityId = operation.type === 'create-entity'
    ? operation.targetEntityId
    : operation.targetRelationshipId;
  const kind = operation.type === 'create-entity'
    ? `template-entity:${operation.entityKind}`
    : `template-relationship:${operation.relationshipKind}`;
  return {
    kind: 'create',
    entity: { kind, entityId, revision: 'absent' },
    nextRevision: 'created:1',
    payload: {
      adapterVersion: MOTION_LEAF_MUTATION_ADAPTER_VERSION,
      leafDomain: 'md8-template',
      leafOperation: cloneJson(operation) as unknown as MotionJsonObject,
    },
  };
}

export interface AdaptMotionTemplateMutationInput {
  readonly plan: MotionTemplateInstantiatePlan;
  readonly plannerInput: PlanMotionTemplateInstantiationInput;
  readonly destinationExpectedRevision: string;
  readonly destinationNextRevision: string;
}

/** Losslessly wraps the existing MD8 one-batch plan in the shared L0 batch contract. */
export function adaptMotionTemplateInstantiationBatch(
  input: AdaptMotionTemplateMutationInput,
): MotionAtomicMutationBatch {
  assertInertJsonTree(input);
  const { plan } = input;
  assertTemplateInstantiationPlan(plan);
  const recomputed = planMotionTemplateInstantiation(input.plannerInput);
  if (
    !recomputed.ok
    || JSON.stringify(recomputed.plan) !== JSON.stringify(plan)
  ) {
    throw new Error('Motion template mutation plan must match its exact planner provenance');
  }
  if (
    plan.contractVersion !== MOTION_TEMPLATE_VERSION
    || plan.batch.mode !== 'single-undo-batch'
    || plan.batch.atomic !== true
    || plan.batch.operations.length === 0
    || !input.destinationExpectedRevision
    || !input.destinationNextRevision
    || input.destinationExpectedRevision === input.destinationNextRevision
  ) {
    throw new Error('Motion template mutation adapter input is invalid');
  }
  const operations: MotionMutationOperation[] = [{
    kind: 'update',
    entity: {
      kind: 'composition',
      entityId: plan.destinationCompositionId,
      revision: input.destinationExpectedRevision,
    },
    nextRevision: input.destinationNextRevision,
    payload: {
      adapterVersion: MOTION_LEAF_MUTATION_ADAPTER_VERSION,
      leafDomain: 'md8-template',
      templateId: plan.templateId,
      insertionTime: plan.insertionTime,
      leafPlan: cloneJson(plan) as unknown as MotionJsonObject,
    },
  }, ...plan.batch.operations.map(templateOperationToMutation)];
  const batch: MotionAtomicMutationBatch = {
    contractVersion: MOTION_MUTATION_BATCH_VERSION,
    batchId: plan.batch.batchId,
    label: 'Instantiate Motion template',
    atomic: true,
    expectedRevisions: [{
      kind: 'composition',
      entityId: plan.destinationCompositionId,
      revision: input.destinationExpectedRevision,
    }],
    operations,
    history: { mode: 'single-entry', undoable: true },
  };
  assertMotionAtomicMutationBatch(batch);
  return cloneJson(batch);
}

export interface AdaptMotionParentMutationInput {
  readonly plan: MotionParentMutationPlan;
  readonly plannerInput: PlanMotionParentMutationInput;
  readonly direction?: 'apply' | 'undo';
}

export function adaptMotionParentMutationBatch(
  input: AdaptMotionParentMutationInput,
): MotionAtomicMutationBatch {
  assertInertJsonTree(input);
  const { plan, plannerInput } = input;
  const direction = input.direction ?? 'apply';
  assertParentMutationPlan(plan);
  const recomputed = planMotionParentMutation(plannerInput);
  if (!recomputed.ok || JSON.stringify(recomputed.plan) !== JSON.stringify(plan)) {
    throw new Error('Motion parent mutation plan must match its exact planner provenance');
  }
  const leafDirection = plan[direction];
  const compositionIds = new Set(leafDirection.graph.nodes.map((node) => node.compositionId));
  if (
    compositionIds.size !== 1
    || leafDirection.graph.revision !== leafDirection.nextRevision
    || leafDirection.expectedRevision === leafDirection.nextRevision
  ) {
    throw new Error('Motion parent mutation adapter input is invalid');
  }
  const entityId = [...compositionIds][0];
  const batch: MotionAtomicMutationBatch = {
    contractVersion: MOTION_MUTATION_BATCH_VERSION,
    batchId: `md6:${plan.kind}:${direction}:${leafDirection.nextRevision}`,
    label: direction === 'apply' ? plan.history.label : `Undo ${plan.history.label}`,
    atomic: true,
    expectedRevisions: [{
      kind: 'parent-graph',
      entityId,
      revision: leafDirection.expectedRevision,
    }],
    operations: [{
      kind: 'update',
      entity: {
        kind: 'parent-graph',
        entityId,
        revision: leafDirection.expectedRevision,
      },
      nextRevision: leafDirection.nextRevision,
      payload: {
        adapterVersion: MOTION_LEAF_MUTATION_ADAPTER_VERSION,
        leafDomain: 'md6-parent',
        selectedDirection: direction,
        leafPlan: cloneJson(plan) as unknown as MotionJsonObject,
      },
    }],
    history: { mode: 'single-entry', undoable: true },
  };
  assertMotionAtomicMutationBatch(batch);
  return cloneJson(batch);
}
