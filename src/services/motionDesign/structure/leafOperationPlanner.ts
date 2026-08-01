import {
  MOTION_PARENT_DIAGNOSTIC_CODES,
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
  MOTION_PARENT_GRAPH_CONTRACT_VERSION,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentFailure,
  type MotionParentGraphEvaluation,
  type MotionParentGraphNode,
  type MotionParentGraphSnapshot,
  type MotionParentPlanResult,
  type MotionParentRelationshipChange,
  type MotionParentTransform2D,
} from './contracts';
import {
  MOTION_STRUCTURE_LEAF_BUDGETS,
  type MotionStructureLeafDiagnostic,
  type MotionStructureLeafOperationKind,
  type MotionStructureLeafOperationPlan,
  type MotionStructureLeafPlanResult,
  type MotionStructureNullEntity2D,
  type PlanMotionClearParentInput,
  type PlanMotionCreateNullAndParentSelectedInput,
  type PlanMotionCreateNullInput,
  type PlanMotionSetParentInput,
  type PlanMotionStructureSemanticIntentInput,
} from './leafContracts';
import {
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
  planMotionParentMutation,
  validateMotionParentGraph,
} from './parentGraphPlanner';
import {
  cloneMotionParentTransform2D,
  deriveMotionParentLocalTransform2D,
  isFiniteMotionParentTransform2D,
} from './parentTransformMath';
import {
  inspectMotionParentStableIdArray,
  isValidMotionParentStableId,
} from './stableId';

interface ExactRecordInspection {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

function inspectExactRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = allowedKeys,
): ExactRecordInspection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!keys.every((key) => allowedKeys.has(key))) return null;
  if (![...requiredKeys].every((key) => Object.hasOwn(descriptors, key))) return null;
  if (!keys.every((key) => descriptors[key].enumerable && 'value' in descriptors[key])) return null;
  return { descriptors };
}

const TRANSFORM_KEYS = new Set(['position', 'scale', 'rotationZ', 'opacity']);
const POSITION_KEYS = new Set(['x', 'y']);
const SCALE_KEYS = new Set(['all', 'x', 'y']);
const NULL_ENTITY_KEYS = new Set(['kind', 'clipId', 'compositionId', 'space', 'localTransform']);
const CREATE_NULL_INPUT_KEYS = new Set(['graph', 'timelineTime', 'nullEntity']);
const SET_PARENT_INPUT_KEYS = new Set(['graph', 'evaluation', 'childClipId', 'parentClipId']);
const CLEAR_PARENT_INPUT_KEYS = new Set(['graph', 'evaluation', 'childClipId']);
const CREATE_AND_PARENT_INPUT_KEYS = new Set([
  'graph',
  'evaluation',
  'nullEntity',
  'selectedClipIds',
]);
const SEMANTIC_INPUT_KEYS = new Set(['graph', 'intent']);
const CREATE_NULL_INTENT_KEYS = new Set(['type', 'timelineTime', 'nullEntity']);
const SET_PARENT_INTENT_KEYS = new Set(['type', 'evaluation', 'childClipId', 'parentClipId']);
const CLEAR_PARENT_INTENT_KEYS = new Set(['type', 'evaluation', 'childClipId']);
const CREATE_AND_PARENT_INTENT_KEYS = new Set([
  'type',
  'evaluation',
  'nullEntity',
  'selectedClipIds',
]);
const GROUP_INTENT_KEYS = new Set(['type', 'selectedClipIds']);

function failure(
  code: MotionParentFailure['code'],
  message: string,
  clipIds: readonly string[] = [],
): MotionParentFailure {
  return { code, message, clipIds: [...new Set(clipIds)].sort() };
}

function blockedDiagnostic(
  blockedBy: MotionParentFailure['code'],
  message: string,
  clipIds: readonly string[],
): MotionStructureLeafDiagnostic {
  return {
    code: MOTION_PARENT_DIAGNOSTIC_CODES.RELATIONSHIP_BLOCKED,
    blockedBy,
    message,
    clipIds: [...new Set(clipIds)].sort(),
  };
}

function failureResult(
  failures: readonly MotionParentFailure[],
  diagnostics: readonly MotionStructureLeafDiagnostic[] = [],
): MotionStructureLeafPlanResult {
  return {
    ok: false,
    failures: failures.slice(0, MOTION_STRUCTURE_LEAF_BUDGETS.maxDiagnostics),
    diagnostics: diagnostics.slice(0, MOTION_STRUCTURE_LEAF_BUDGETS.maxDiagnostics),
  };
}

function inspectTransform(value: unknown): MotionParentTransform2D | null {
  const transform = inspectExactRecord(value, TRANSFORM_KEYS);
  if (!transform) return null;
  const position = inspectExactRecord(transform.descriptors.position.value, POSITION_KEYS);
  const scale = inspectExactRecord(transform.descriptors.scale.value, SCALE_KEYS);
  if (!position || !scale) return null;
  const candidate: MotionParentTransform2D = {
    position: {
      x: position.descriptors.x.value as number,
      y: position.descriptors.y.value as number,
    },
    scale: {
      all: scale.descriptors.all.value as number,
      x: scale.descriptors.x.value as number,
      y: scale.descriptors.y.value as number,
    },
    rotationZ: transform.descriptors.rotationZ.value as number,
    opacity: transform.descriptors.opacity.value as number,
  };
  return isFiniteMotionParentTransform2D(candidate) ? candidate : null;
}

function inspectNullEntity(value: unknown): MotionStructureNullEntity2D | null {
  const entity = inspectExactRecord(value, NULL_ENTITY_KEYS);
  if (!entity) return null;
  const clipId = entity.descriptors.clipId.value;
  const compositionId = entity.descriptors.compositionId.value;
  const localTransform = inspectTransform(entity.descriptors.localTransform.value);
  if (
    entity.descriptors.kind.value !== 'null' ||
    entity.descriptors.space.value !== '2d' ||
    !isValidMotionParentStableId(clipId) ||
    !isValidMotionParentStableId(compositionId) ||
    !localTransform
  ) {
    return null;
  }
  return {
    kind: 'null',
    clipId,
    compositionId,
    space: '2d',
    localTransform: cloneMotionParentTransform2D(localTransform),
  };
}

function cloneNullEntity(entity: MotionStructureNullEntity2D): MotionStructureNullEntity2D {
  return {
    kind: 'null',
    clipId: entity.clipId,
    compositionId: entity.compositionId,
    space: '2d',
    localTransform: cloneMotionParentTransform2D(entity.localTransform),
  };
}

function validateAndCopyGraph(
  graph: unknown,
): { readonly graph?: MotionParentGraphSnapshot; readonly failures: readonly MotionParentFailure[] } {
  const graphFailures = validateMotionParentGraph(graph as MotionParentGraphSnapshot);
  if (graphFailures.length > 0) return { failures: graphFailures };
  const source = graph as MotionParentGraphSnapshot;
  return { graph: createMotionParentGraphSnapshot(source.nodes), failures: [] };
}

function relationshipDiagnostics(
  failures: readonly MotionParentFailure[],
  fallbackClipIds: readonly string[],
): readonly MotionStructureLeafDiagnostic[] {
  return failures.slice(0, MOTION_STRUCTURE_LEAF_BUDGETS.maxDiagnostics).map((item) => (
    blockedDiagnostic(
      item.code,
      item.message,
      item.clipIds.length > 0 ? item.clipIds : fallbackClipIds,
    )
  ));
}

function convertMutationPlan(
  result: MotionParentPlanResult,
  kind: Extract<MotionStructureLeafOperationKind, 'set-parent' | 'clear-parent'>,
  fallbackClipIds: readonly string[],
): MotionStructureLeafPlanResult {
  if (!result.ok) {
    return failureResult(result.failures, relationshipDiagnostics(result.failures, fallbackClipIds));
  }
  const mutation = result.plan;
  const plan: MotionStructureLeafOperationPlan = {
    contractVersion: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
    kind,
    timelineTime: mutation.timelineTime,
    preservation: MOTION_PARENT_WORLD_PRESERVATION,
    affectedClipIds: [...mutation.affectedClipIds],
    preservedWorldTransformsAtOperationTime: [{
      clipId: mutation.apply.changes[0].clipId,
      transform: cloneMotionParentTransform2D(mutation.childWorldTransformAtOperationTime),
    }],
    apply: {
      expectedRevision: mutation.apply.expectedRevision,
      nextRevision: mutation.apply.nextRevision,
      graph: createMotionParentGraphSnapshot(mutation.apply.graph.nodes),
      executionOrder: ['relationship-changes'],
      nullChanges: [],
      relationshipChanges: mutation.apply.changes.map((change) => ({
        ...change,
        fromLocalTransform: cloneMotionParentTransform2D(change.fromLocalTransform),
        toLocalTransform: cloneMotionParentTransform2D(change.toLocalTransform),
      })),
    },
    undo: {
      expectedRevision: mutation.undo.expectedRevision,
      nextRevision: mutation.undo.nextRevision,
      graph: createMotionParentGraphSnapshot(mutation.undo.graph.nodes),
      executionOrder: ['relationship-changes'],
      nullChanges: [],
      relationshipChanges: mutation.undo.changes.map((change) => ({
        ...change,
        fromLocalTransform: cloneMotionParentTransform2D(change.fromLocalTransform),
        toLocalTransform: cloneMotionParentTransform2D(change.toLocalTransform),
      })),
    },
    diagnostics: [],
    history: {
      mode: 'single-entry',
      label: kind === 'set-parent' ? 'Set Parent' : 'Clear Parent',
      atomic: true,
    },
  };
  return { ok: true, plan, failures: [], diagnostics: [] };
}

export function planMotionCreateNull(
  input: PlanMotionCreateNullInput,
): MotionStructureLeafPlanResult {
  const inspected = inspectExactRecord(input, CREATE_NULL_INPUT_KEYS);
  if (!inspected) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Create-null input must be an exact inert envelope.',
    )]);
  }
  const timelineTime = inspected.descriptors.timelineTime.value;
  const nullEntity = inspectNullEntity(inspected.descriptors.nullEntity.value);
  if (typeof timelineTime !== 'number' || !Number.isFinite(timelineTime) || !nullEntity) {
    return failureResult([failure(
      nullEntity
        ? MOTION_PARENT_ERROR_CODES.INVALID_TIMELINE_TIME
        : MOTION_PARENT_ERROR_CODES.NULL_DESCRIPTOR_INVALID,
      'Create-null requires a finite operation time and an exact 2D null descriptor.',
    )]);
  }
  const graphResult = validateAndCopyGraph(inspected.descriptors.graph.value);
  if (!graphResult.graph) return failureResult(graphResult.failures);
  const previousGraph = graphResult.graph;
  if (previousGraph.nodes.length >= MOTION_PARENT_GRAPH_BUDGETS.maxNodes) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED,
      'Creating a null would exceed the parent graph node budget.',
      [nullEntity.clipId],
    )]);
  }
  if (previousGraph.nodes.some((node) => node.clipId === nullEntity.clipId)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.NULL_ID_EXISTS,
      'The requested null id already exists in the parent graph.',
      [nullEntity.clipId],
    )]);
  }
  const nextGraph = createMotionParentGraphSnapshot([
    ...previousGraph.nodes,
    {
      clipId: nullEntity.clipId,
      compositionId: nullEntity.compositionId,
      space: '2d',
    },
  ]);
  const createdNull = cloneNullEntity(nullEntity);
  const deletedNull = cloneNullEntity(nullEntity);
  const plan: MotionStructureLeafOperationPlan = {
    contractVersion: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
    kind: 'create-null',
    timelineTime,
    preservation: MOTION_PARENT_WORLD_PRESERVATION,
    affectedClipIds: [nullEntity.clipId],
    preservedWorldTransformsAtOperationTime: [],
    apply: {
      expectedRevision: previousGraph.revision,
      nextRevision: nextGraph.revision,
      graph: nextGraph,
      executionOrder: ['null-changes'],
      nullChanges: [{ action: 'create', entity: createdNull }],
      relationshipChanges: [],
    },
    undo: {
      expectedRevision: nextGraph.revision,
      nextRevision: previousGraph.revision,
      graph: previousGraph,
      executionOrder: ['null-changes'],
      nullChanges: [{ action: 'delete', entity: deletedNull }],
      relationshipChanges: [],
    },
    diagnostics: [],
    history: { mode: 'single-entry', label: 'Create Null', atomic: true },
  };
  return { ok: true, plan, failures: [], diagnostics: [] };
}

export function planMotionSetParent(
  input: PlanMotionSetParentInput,
): MotionStructureLeafPlanResult {
  const inspected = inspectExactRecord(input, SET_PARENT_INPUT_KEYS);
  if (!inspected) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Set-parent input must be an exact inert envelope.',
    )]);
  }
  const childClipId = inspected.descriptors.childClipId.value;
  const parentClipId = inspected.descriptors.parentClipId.value;
  if (!isValidMotionParentStableId(childClipId) || !isValidMotionParentStableId(parentClipId)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Set-parent requires stable child and parent ids.',
    )]);
  }
  return convertMutationPlan(planMotionParentMutation({
    graph: inspected.descriptors.graph.value as MotionParentGraphSnapshot,
    evaluation: inspected.descriptors.evaluation.value as MotionParentGraphEvaluation,
    childClipId,
    parentClipId,
  }), 'set-parent', [childClipId, parentClipId]);
}

export function planMotionClearParent(
  input: PlanMotionClearParentInput,
): MotionStructureLeafPlanResult {
  const inspected = inspectExactRecord(input, CLEAR_PARENT_INPUT_KEYS);
  if (!inspected) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Clear-parent input must be an exact inert envelope.',
    )]);
  }
  const childClipId = inspected.descriptors.childClipId.value;
  if (!isValidMotionParentStableId(childClipId)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Clear-parent requires a stable child id.',
    )]);
  }
  return convertMutationPlan(planMotionParentMutation({
    graph: inspected.descriptors.graph.value as MotionParentGraphSnapshot,
    evaluation: inspected.descriptors.evaluation.value as MotionParentGraphEvaluation,
    childClipId,
  }), 'clear-parent', [childClipId]);
}

function collectAffectedClipIds(
  graph: MotionParentGraphSnapshot,
  roots: ReadonlySet<string>,
  createdNullId: string,
): readonly string[] {
  const affected = new Set<string>([createdNullId, ...roots]);
  const childrenByParent = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (!node.parentClipId) continue;
    const children = childrenByParent.get(node.parentClipId) ?? [];
    children.push(node.clipId);
    childrenByParent.set(node.parentClipId, children);
  }
  const queue = [...roots].sort();
  for (let index = 0; index < queue.length; index += 1) {
    for (const childId of childrenByParent.get(queue[index]) ?? []) {
      if (affected.has(childId)) continue;
      affected.add(childId);
      queue.push(childId);
    }
  }
  return [...affected].sort();
}

export function planMotionCreateNullAndParentSelected(
  input: PlanMotionCreateNullAndParentSelectedInput,
): MotionStructureLeafPlanResult {
  const inspected = inspectExactRecord(input, CREATE_AND_PARENT_INPUT_KEYS);
  if (!inspected) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Create-null-and-parent input must be an exact inert envelope.',
    )]);
  }
  const nullEntity = inspectNullEntity(inspected.descriptors.nullEntity.value);
  if (!nullEntity) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.NULL_DESCRIPTOR_INVALID,
      'Atomic null creation requires an exact finite 2D null descriptor.',
    )]);
  }
  const selectedInspection = inspectMotionParentStableIdArray(
    inspected.descriptors.selectedClipIds.value,
  );
  if (!selectedInspection.ok) {
    return failureResult([failure(
      selectedInspection.budgetExceeded
        ? MOTION_PARENT_ERROR_CODES.BATCH_BUDGET_EXCEEDED
        : MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Selected clip ids must be a bounded native dense array of stable ids.',
    )]);
  }
  if (
    selectedInspection.values.length === 0 ||
    selectedInspection.values.length > MOTION_STRUCTURE_LEAF_BUDGETS.maxSelectedClipIds
  ) {
    return failureResult([failure(
      selectedInspection.values.length > MOTION_STRUCTURE_LEAF_BUDGETS.maxSelectedClipIds
        ? MOTION_PARENT_ERROR_CODES.BATCH_BUDGET_EXCEEDED
        : MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Atomic null parenting requires a non-empty selection within the batch budget.',
    )]);
  }
  const selectedClipIds = [...selectedInspection.values].sort();
  if (new Set(selectedClipIds).size !== selectedClipIds.length) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Atomic null parenting requires unique selected clip ids.',
      selectedClipIds,
    )]);
  }

  const graphResult = validateAndCopyGraph(inspected.descriptors.graph.value);
  if (!graphResult.graph) return failureResult(graphResult.failures);
  const previousGraph = graphResult.graph;
  if (previousGraph.nodes.length >= MOTION_PARENT_GRAPH_BUDGETS.maxNodes) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED,
      'Creating a null would exceed the parent graph node budget.',
      [nullEntity.clipId],
    )]);
  }
  if (previousGraph.nodes.some((node) => node.clipId === nullEntity.clipId)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.NULL_ID_EXISTS,
      'The requested null id already exists in the parent graph.',
      [nullEntity.clipId],
    )]);
  }

  const nodesById = new Map(previousGraph.nodes.map((node) => [node.clipId, node]));
  const relationshipFailures: MotionParentFailure[] = [];
  const diagnostics: MotionStructureLeafDiagnostic[] = [];
  for (const childClipId of selectedClipIds) {
    const child = nodesById.get(childClipId);
    let blocked: MotionParentFailure | undefined;
    if (!child) {
      blocked = failure(
        MOTION_PARENT_ERROR_CODES.CHILD_MISSING,
        'A selected child is not present in the parent graph.',
        [childClipId],
      );
    } else if (child.compositionId !== nullEntity.compositionId) {
      blocked = failure(
        MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH,
        'Selected clips and the created null must share one composition.',
        [childClipId, nullEntity.clipId],
      );
    } else if (child.space !== '2d') {
      blocked = failure(
        MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
        'Structure leaf parenting supports only 2D selected clips.',
        [childClipId, nullEntity.clipId],
      );
    }
    if (blocked) {
      relationshipFailures.push(blocked);
      diagnostics.push(blockedDiagnostic(
        blocked.code,
        blocked.message,
        blocked.clipIds,
      ));
    }
  }
  if (relationshipFailures.length > 0) return failureResult(relationshipFailures, diagnostics);

  const evaluation = inspected.descriptors.evaluation.value as MotionParentGraphEvaluation;
  const worldEvaluation = evaluateMotionParentGraphWorldTransforms(previousGraph, evaluation);
  if (!worldEvaluation.worlds) {
    return failureResult(
      worldEvaluation.failures,
      relationshipDiagnostics(worldEvaluation.failures, selectedClipIds),
    );
  }
  const localById = new Map(evaluation.localTransforms.map((entry) => [entry.clipId, entry.transform]));
  const selectedSet = new Set(selectedClipIds);
  const forwardChanges: MotionParentRelationshipChange[] = [];
  const undoChanges: MotionParentRelationshipChange[] = [];
  const preservedWorldTransforms: Array<{ clipId: string; transform: MotionParentTransform2D }> = [];
  for (const childClipId of selectedClipIds) {
    const child = nodesById.get(childClipId)!;
    const childWorld = worldEvaluation.worlds.get(childClipId)!;
    const inverse = deriveMotionParentLocalTransform2D(
      nullEntity.localTransform,
      childWorld,
      [childClipId, nullEntity.clipId],
    );
    if (!inverse.ok) {
      relationshipFailures.push(inverse.failure);
      diagnostics.push(blockedDiagnostic(
        inverse.failure.code,
        inverse.failure.message,
        inverse.failure.clipIds,
      ));
      continue;
    }
    const fromLocal = cloneMotionParentTransform2D(localById.get(childClipId)!);
    const toLocal = cloneMotionParentTransform2D(inverse.transform);
    forwardChanges.push({
      clipId: childClipId,
      ...(child.parentClipId ? { fromParentClipId: child.parentClipId } : {}),
      toParentClipId: nullEntity.clipId,
      fromLocalTransform: fromLocal,
      toLocalTransform: toLocal,
    });
    undoChanges.push({
      clipId: childClipId,
      fromParentClipId: nullEntity.clipId,
      ...(child.parentClipId ? { toParentClipId: child.parentClipId } : {}),
      fromLocalTransform: cloneMotionParentTransform2D(toLocal),
      toLocalTransform: cloneMotionParentTransform2D(fromLocal),
    });
    preservedWorldTransforms.push({
      clipId: childClipId,
      transform: cloneMotionParentTransform2D(childWorld),
    });
  }
  if (relationshipFailures.length > 0) return failureResult(relationshipFailures, diagnostics);
  if (forwardChanges.length > MOTION_STRUCTURE_LEAF_BUDGETS.maxRelationshipChanges) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.BATCH_BUDGET_EXCEEDED,
      'Atomic null parenting exceeds the relationship-change budget.',
      selectedClipIds,
    )]);
  }

  const nextNodes: MotionParentGraphNode[] = previousGraph.nodes.map((node) => (
    selectedSet.has(node.clipId)
      ? {
          clipId: node.clipId,
          compositionId: node.compositionId,
          space: node.space,
          parentClipId: nullEntity.clipId,
        }
      : node
  ));
  nextNodes.push({
    clipId: nullEntity.clipId,
    compositionId: nullEntity.compositionId,
    space: '2d',
  });
  const nextGraph = createMotionParentGraphSnapshot(nextNodes);
  const candidateFailures = validateMotionParentGraph(nextGraph);
  if (candidateFailures.length > 0) {
    return failureResult(
      candidateFailures,
      relationshipDiagnostics(candidateFailures, selectedClipIds),
    );
  }

  const createdNull = cloneNullEntity(nullEntity);
  const deletedNull = cloneNullEntity(nullEntity);
  const plan: MotionStructureLeafOperationPlan = {
    contractVersion: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
    kind: 'create-null-and-parent-selected',
    timelineTime: evaluation.timelineTime,
    preservation: MOTION_PARENT_WORLD_PRESERVATION,
    affectedClipIds: collectAffectedClipIds(previousGraph, selectedSet, nullEntity.clipId),
    preservedWorldTransformsAtOperationTime: preservedWorldTransforms,
    apply: {
      expectedRevision: previousGraph.revision,
      nextRevision: nextGraph.revision,
      graph: nextGraph,
      executionOrder: ['null-changes', 'relationship-changes'],
      nullChanges: [{ action: 'create', entity: createdNull }],
      relationshipChanges: forwardChanges,
    },
    undo: {
      expectedRevision: nextGraph.revision,
      nextRevision: previousGraph.revision,
      graph: previousGraph,
      executionOrder: ['relationship-changes', 'null-changes'],
      nullChanges: [{ action: 'delete', entity: deletedNull }],
      relationshipChanges: undoChanges,
    },
    diagnostics: [],
    history: {
      mode: 'single-entry',
      label: 'Create Null and Parent Selection',
      atomic: true,
    },
  };
  return { ok: true, plan, failures: [], diagnostics: [] };
}

export function planMotionStructureSemanticIntent(
  input: PlanMotionStructureSemanticIntentInput,
): MotionStructureLeafPlanResult {
  const inspected = inspectExactRecord(input, SEMANTIC_INPUT_KEYS);
  if (!inspected) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Structure semantic input must be an exact inert envelope.',
    )]);
  }
  const intentValue = inspected.descriptors.intent.value;
  if (intentValue === null || typeof intentValue !== 'object' || Array.isArray(intentValue)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Structure intent must be an exact inert object.',
    )]);
  }
  const typeDescriptor = Object.getOwnPropertyDescriptor(intentValue, 'type');
  if (!typeDescriptor || !typeDescriptor.enumerable || !('value' in typeDescriptor)) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Structure intent requires an inert type discriminator.',
    )]);
  }
  const type = typeDescriptor.value;
  const keys = type === 'create-null'
    ? CREATE_NULL_INTENT_KEYS
    : type === 'set-parent'
      ? SET_PARENT_INTENT_KEYS
      : type === 'clear-parent'
        ? CLEAR_PARENT_INTENT_KEYS
        : type === 'create-null-and-parent-selected'
          ? CREATE_AND_PARENT_INTENT_KEYS
          : type === 'group'
            ? GROUP_INTENT_KEYS
            : undefined;
  const intent = keys ? inspectExactRecord(intentValue, keys) : null;
  if (!intent) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Structure intent type or fields are unsupported.',
    )]);
  }
  const graph = inspected.descriptors.graph.value as MotionParentGraphSnapshot;
  if (type === 'create-null') {
    return planMotionCreateNull({
      graph,
      timelineTime: intent.descriptors.timelineTime.value as number,
      nullEntity: intent.descriptors.nullEntity.value as MotionStructureNullEntity2D,
    });
  }
  if (type === 'set-parent') {
    return planMotionSetParent({
      graph,
      evaluation: intent.descriptors.evaluation.value as MotionParentGraphEvaluation,
      childClipId: intent.descriptors.childClipId.value as string,
      parentClipId: intent.descriptors.parentClipId.value as string,
    });
  }
  if (type === 'clear-parent') {
    return planMotionClearParent({
      graph,
      evaluation: intent.descriptors.evaluation.value as MotionParentGraphEvaluation,
      childClipId: intent.descriptors.childClipId.value as string,
    });
  }
  if (type === 'create-null-and-parent-selected') {
    return planMotionCreateNullAndParentSelected({
      graph,
      evaluation: intent.descriptors.evaluation.value as MotionParentGraphEvaluation,
      nullEntity: intent.descriptors.nullEntity.value as MotionStructureNullEntity2D,
      selectedClipIds: intent.descriptors.selectedClipIds.value as readonly string[],
    });
  }

  const selectedInspection = inspectMotionParentStableIdArray(
    intent.descriptors.selectedClipIds.value,
  );
  if (
    !selectedInspection.ok ||
    selectedInspection.values.length > MOTION_STRUCTURE_LEAF_BUDGETS.maxSelectedClipIds
  ) {
    return failureResult([failure(
      MOTION_PARENT_ERROR_CODES.INTENT_INVALID,
      'Disabled group intent still requires a bounded inert selection.',
    )]);
  }
  const graphFailures = validateMotionParentGraph(graph);
  if (graphFailures.length > 0) return failureResult(graphFailures);
  const clipIds = [...selectedInspection.values].sort();
  const diagnostic: MotionStructureLeafDiagnostic = {
    code: MOTION_PARENT_DIAGNOSTIC_CODES.GROUPS_OUT_OF_SCOPE,
    blockedBy: MOTION_PARENT_ERROR_CODES.GROUP_INTENT_UNSUPPORTED,
    message: 'Group intent is explicitly disabled in the Structure 1.0 leaf contract.',
    clipIds,
  };
  return failureResult([failure(
    MOTION_PARENT_ERROR_CODES.GROUP_INTENT_UNSUPPORTED,
    diagnostic.message,
    clipIds,
  )], [diagnostic]);
}
