import {
  MOTION_PARENT_DIAGNOSTIC_CODES,
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
  MOTION_PARENT_GRAPH_CONTRACT_VERSION,
  MOTION_PARENT_WORLD_PRESERVATION,
  type MotionParentFailure,
  type MotionParentDiagnostic,
  type MotionParentGraphEvaluation,
  type MotionParentGraphNode,
  type MotionParentGraphSnapshot,
  type MotionParentMutationKind,
  type MotionParentPlanResult,
  type MotionParentRemapResult,
  type MotionParentRelationshipChange,
  type MotionParentTransform2D,
} from './contracts';
import {
  cloneMotionParentTransform2D,
  composeMotionParentTransforms2D,
  deriveMotionParentLocalTransform2D,
  isFiniteMotionParentTransform2D,
} from './parentTransformMath';
import { isValidMotionParentStableId } from './stableId';

function canonicalizeNodes(nodes: readonly MotionParentGraphNode[]): MotionParentGraphNode[] {
  const array = inspectDenseDataArray(nodes, MOTION_PARENT_GRAPH_BUDGETS.maxNodes);
  if (!array.ok) throw new TypeError('Parent graph nodes must be a bounded native dense array.');
  const canonicalNodes: MotionParentGraphNode[] = [];
  for (const rawNode of array.values) {
    const node = inspectExactRecord(rawNode, NODE_KEYS, NODE_REQUIRED_KEYS);
    if (!node) throw new TypeError('Parent graph nodes must be exact inert objects.');
    const clipId = node.descriptors.clipId.value;
    const compositionId = node.descriptors.compositionId.value;
    const space = node.descriptors.space.value;
    const parentClipId = node.descriptors.parentClipId?.value;
    if (
      !isValidMotionParentStableId(clipId) ||
      !isValidMotionParentStableId(compositionId) ||
      (space !== '2d' && space !== '3d') ||
      (parentClipId !== undefined && !isValidMotionParentStableId(parentClipId))
    ) {
      throw new TypeError('Parent graph nodes contain an invalid stable id or space.');
    }
    canonicalNodes.push({
      clipId,
      compositionId,
      space,
      ...(parentClipId ? { parentClipId } : {}),
    });
  }
  return canonicalNodes.sort((left, right) => (
    left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0
  ));
}

export interface PlanMotionParentRemapInput {
  readonly sourceGraph: MotionParentGraphSnapshot;
  readonly copiedClipIds: readonly string[];
  readonly targetClipIdsBySourceId: Readonly<Record<string, string>>;
  readonly destinationCompositionId: string;
}

/**
 * Remaps copied parent edges without retaining references into the source
 * selection. Internal edges are remapped; external edges are cleared and
 * reported as non-fatal diagnostics.
 */
export function planMotionParentRemap(
  input: PlanMotionParentRemapInput,
): MotionParentRemapResult {
  const inputFailures = preflightParentRemapInput(input);
  if (inputFailures.length > 0) return { ok: false, failures: inputFailures };

  const graphFailures = validateMotionParentGraph(input.sourceGraph);
  if (graphFailures.length > 0) return { ok: false, failures: graphFailures };

  const sourceNodesById = new Map(input.sourceGraph.nodes.map((node) => [node.clipId, node]));
  const copiedClipIds = [...new Set(input.copiedClipIds)].sort();
  const preflightFailures: MotionParentFailure[] = [];
  for (const sourceClipId of copiedClipIds) {
    if (!sourceNodesById.has(sourceClipId)) {
      preflightFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.CHILD_MISSING,
        'A copied clip is not present in the source parent graph.',
        [sourceClipId],
      ));
    }
    if (!Object.hasOwn(input.targetClipIdsBySourceId, sourceClipId)) {
      preflightFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.REMAP_TARGET_MISSING,
        'Every copied clip requires a stable target id before parent remapping.',
        [sourceClipId],
      ));
    }
  }
  if (!input.destinationCompositionId) {
    preflightFailures.push(failure(
      MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
      'Parent remapping requires a destination composition id.',
      copiedClipIds,
    ));
  }
  if (preflightFailures.length > 0) return { ok: false, failures: preflightFailures };

  const copiedSet = new Set(copiedClipIds);
  const diagnostics: MotionParentDiagnostic[] = [];
  const assignments = copiedClipIds.map((sourceClipId) => {
    const sourceNode = sourceNodesById.get(sourceClipId)!;
    const targetClipId = input.targetClipIdsBySourceId[sourceClipId];
    let parentClipId: string | undefined;
    if (sourceNode.parentClipId && copiedSet.has(sourceNode.parentClipId)) {
      parentClipId = input.targetClipIdsBySourceId[sourceNode.parentClipId];
    } else if (sourceNode.parentClipId) {
      diagnostics.push({
        code: MOTION_PARENT_DIAGNOSTIC_CODES.EXTERNAL_EDGE_CLEARED,
        message: 'The copied child had an external parent; the target edge was cleared.',
        clipIds: [sourceNode.clipId, sourceNode.parentClipId].sort(),
      });
    }
    return {
      sourceClipId,
      targetClipId,
      ...(parentClipId ? { parentClipId } : {}),
    };
  });

  const targetNodes = assignments.map((assignment) => {
    const sourceNode = sourceNodesById.get(assignment.sourceClipId)!;
    return {
      clipId: assignment.targetClipId,
      compositionId: input.destinationCompositionId,
      space: sourceNode.space,
      ...(assignment.parentClipId ? { parentClipId: assignment.parentClipId } : {}),
    } satisfies MotionParentGraphNode;
  });
  const graph = createMotionParentGraphSnapshot(targetNodes);
  const targetFailures = validateMotionParentGraph(graph);
  if (targetFailures.length > 0) return { ok: false, failures: targetFailures };

  return {
    ok: true,
    failures: [],
    plan: {
      contractVersion: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
      destinationCompositionId: input.destinationCompositionId,
      assignments,
      graph,
      diagnostics,
    },
  };
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function calculateMotionParentGraphRevision(
  nodes: readonly MotionParentGraphNode[],
): string {
  return `md6pg1-${fnv1a64(JSON.stringify(canonicalizeNodes(nodes)))}`;
}

export function createMotionParentGraphSnapshot(
  nodes: readonly MotionParentGraphNode[],
): MotionParentGraphSnapshot {
  const canonicalNodes = canonicalizeNodes(nodes);
  return {
    version: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
    revision: calculateMotionParentGraphRevision(canonicalNodes),
    nodes: canonicalNodes,
  };
}

function failure(
  code: MotionParentFailure['code'],
  message: string,
  clipIds: readonly string[],
): MotionParentFailure {
  return { code, message, clipIds: [...new Set(clipIds)].sort() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ExactRecordInspection {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

function inspectExactRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = allowedKeys,
): ExactRecordInspection | null {
  if (!isRecord(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (!keys.every((key) => allowedKeys.has(key))) return null;
  if (![...requiredKeys].every((key) => Object.prototype.hasOwnProperty.call(descriptors, key))) {
    return null;
  }
  if (!keys.every((key) => descriptors[key].enumerable && 'value' in descriptors[key])) {
    return null;
  }
  return { descriptors };
}

type DenseArrayInspection =
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

function inspectDenseDataArray(value: unknown, maxLength: number): DenseArrayInspection {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return { ok: false, budgetExceeded: false };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return { ok: false, budgetExceeded: false };
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !('value' in lengthDescriptor)) return { ok: false, budgetExceeded: false };
  const length = lengthDescriptor.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return { ok: false, budgetExceeded: false };
  }
  if (length > maxLength) return { ok: false, budgetExceeded: true };
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => (
    typeof key === 'symbol' ||
    (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
  ))) {
    return { ok: false, budgetExceeded: false };
  }
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return { ok: false, budgetExceeded: false };
    }
    values.push(descriptor.value);
  }
  return { ok: true, values };
}

const GRAPH_KEYS = new Set(['version', 'revision', 'nodes']);
const NODE_KEYS = new Set(['clipId', 'compositionId', 'space', 'parentClipId']);
const NODE_REQUIRED_KEYS = new Set(['clipId', 'compositionId', 'space']);
const EVALUATION_KEYS = new Set(['timelineTime', 'localTransforms']);
const EVALUATION_ENTRY_KEYS = new Set(['clipId', 'transform']);
const TRANSFORM_KEYS = new Set(['position', 'scale', 'rotationZ', 'opacity']);
const POSITION_KEYS = new Set(['x', 'y']);
const SCALE_KEYS = new Set(['all', 'x', 'y']);
const MUTATION_INPUT_KEYS = new Set(['graph', 'evaluation', 'childClipId', 'parentClipId']);
const MUTATION_INPUT_REQUIRED_KEYS = new Set(['graph', 'evaluation', 'childClipId']);
const REMAP_INPUT_KEYS = new Set([
  'sourceGraph',
  'copiedClipIds',
  'targetClipIdsBySourceId',
  'destinationCompositionId',
]);

function preflightParentGraphEnvelope(graph: unknown): readonly MotionParentFailure[] {
  const root = inspectExactRecord(graph, GRAPH_KEYS);
  if (!root) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
      'The parent graph must be an exact inert graph envelope.',
      [],
    )];
  }
  const nodes = inspectDenseDataArray(
    root.descriptors.nodes.value,
    MOTION_PARENT_GRAPH_BUDGETS.maxNodes,
  );
  if (!nodes.ok) {
    return [failure(
      nodes.budgetExceeded
        ? MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED
        : MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
      nodes.budgetExceeded
        ? 'Parent graph exceeds the hard node budget.'
        : 'Parent graph nodes must be a dense inert data array.',
      [],
    )];
  }
  for (const rawNode of nodes.values) {
    if (!inspectExactRecord(rawNode, NODE_KEYS, NODE_REQUIRED_KEYS)) {
      return [failure(
        MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        'Every parent graph node must be an exact inert node envelope.',
        [],
      )];
    }
  }
  return [];
}

function preflightParentEvaluationEnvelope(
  evaluation: unknown,
): readonly MotionParentFailure[] {
  const root = inspectExactRecord(evaluation, EVALUATION_KEYS);
  if (!root) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
      'Parent evaluation must be an exact inert evaluation envelope.',
      [],
    )];
  }
  const entries = inspectDenseDataArray(
    root.descriptors.localTransforms.value,
    MOTION_PARENT_GRAPH_BUDGETS.maxNodes,
  );
  if (!entries.ok) {
    return [failure(
      entries.budgetExceeded
        ? MOTION_PARENT_ERROR_CODES.EVALUATION_BUDGET_EXCEEDED
        : MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
      entries.budgetExceeded
        ? 'Parent evaluation exceeds the hard entry budget.'
        : 'Parent evaluation entries must be a dense inert data array.',
      [],
    )];
  }
  for (const rawEntry of entries.values) {
    const entry = inspectExactRecord(rawEntry, EVALUATION_ENTRY_KEYS);
    if (!entry) {
      return [failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
        'Every evaluation entry must be an exact inert envelope.',
        [],
      )];
    }
    const transform = inspectExactRecord(entry.descriptors.transform.value, TRANSFORM_KEYS);
    if (
      !transform ||
      !inspectExactRecord(transform.descriptors.position.value, POSITION_KEYS) ||
      !inspectExactRecord(transform.descriptors.scale.value, SCALE_KEYS)
    ) {
      return [failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
        'Every local transform must use the exact inert 2D transform shape.',
        [],
      )];
    }
  }
  return [];
}

function preflightParentMutationInput(input: unknown): readonly MotionParentFailure[] {
  const root = inspectExactRecord(input, MUTATION_INPUT_KEYS, MUTATION_INPUT_REQUIRED_KEYS);
  if (!root) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent mutation input must be an exact inert contract envelope.',
      [],
    )];
  }
  const childClipId = root.descriptors.childClipId.value;
  const parentClipId = root.descriptors.parentClipId?.value;
  if (
    !isValidMotionParentStableId(childClipId) ||
    (parentClipId !== undefined && !isValidMotionParentStableId(parentClipId))
  ) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent mutation clip ids must be non-empty strings.',
      [],
    )];
  }
  const graphFailures = preflightParentGraphEnvelope(root.descriptors.graph.value);
  if (graphFailures.length > 0) return graphFailures;
  return preflightParentEvaluationEnvelope(root.descriptors.evaluation.value);
}

function preflightParentRemapInput(input: unknown): readonly MotionParentFailure[] {
  const root = inspectExactRecord(input, REMAP_INPUT_KEYS);
  if (!root) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent remap input must be an exact inert contract envelope.',
      [],
    )];
  }
  const graphFailures = preflightParentGraphEnvelope(root.descriptors.sourceGraph.value);
  if (graphFailures.length > 0) return graphFailures;

  const copiedClipIds = inspectDenseDataArray(
    root.descriptors.copiedClipIds.value,
    MOTION_PARENT_GRAPH_BUDGETS.maxNodes,
  );
  if (!copiedClipIds.ok) {
    return [failure(
      copiedClipIds.budgetExceeded
        ? MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED
        : MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      copiedClipIds.budgetExceeded
        ? 'Parent remap exceeds the hard copied-clip budget.'
        : 'Copied clip ids must be a dense inert data array.',
      [],
    )];
  }
  if (copiedClipIds.values.some((clipId) => !isValidMotionParentStableId(clipId))) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Copied clip ids must be non-empty strings.',
      [],
    )];
  }

  const targetMap = root.descriptors.targetClipIdsBySourceId.value;
  if (!isRecord(targetMap)) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent remap targets must be an inert string map.',
      [],
    )];
  }
  const targetPrototype = Object.getPrototypeOf(targetMap);
  const targetDescriptors = Object.getOwnPropertyDescriptors(targetMap);
  const targetKeys = Object.keys(targetDescriptors);
  if (
    (targetPrototype !== Object.prototype && targetPrototype !== null) ||
    Object.getOwnPropertySymbols(targetMap).length > 0 ||
    targetKeys.length > MOTION_PARENT_GRAPH_BUDGETS.maxNodes ||
    targetKeys.some((key) => (
      !isValidMotionParentStableId(key) ||
      !targetDescriptors[key].enumerable ||
      !('value' in targetDescriptors[key]) ||
      !isValidMotionParentStableId(targetDescriptors[key].value)
    ))
  ) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent remap targets must be an inert map of non-empty strings.',
      [],
    )];
  }
  if (
    !isValidMotionParentStableId(root.descriptors.destinationCompositionId.value)
  ) {
    return [failure(
      MOTION_PARENT_ERROR_CODES.MUTATION_INPUT_INVALID,
      'Parent remapping requires a non-empty destination composition id.',
      [],
    )];
  }
  return [];
}

/** Validates the entire snapshot before any mutation plan can be emitted. */
export function validateMotionParentGraph(
  graph: MotionParentGraphSnapshot,
): readonly MotionParentFailure[] {
  const envelopeFailures = preflightParentGraphEnvelope(graph);
  if (envelopeFailures.length > 0) return envelopeFailures;

  const failures: MotionParentFailure[] = [];
  const nodesById = new Map<string, MotionParentGraphNode>();
  const graphValue = graph as unknown as Record<string, unknown>;
  const validNodes: MotionParentGraphNode[] = [];
  let hasStructurallyInvalidNode = false;
  let graphOrderFailureEmitted = false;
  let previousClipId: string | undefined;

  for (const rawNode of graph.nodes) {
    if (!isRecord(rawNode)) {
      hasStructurallyInvalidNode = true;
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        'Parent graph nodes require a clip id, composition id, and supported space.',
        [],
      ));
      continue;
    }
    const clipId = isValidMotionParentStableId(rawNode.clipId) ? rawNode.clipId : '';
    const compositionId = isValidMotionParentStableId(rawNode.compositionId)
      ? rawNode.compositionId
      : '';
    const space = rawNode.space;
    const rawParentClipId = rawNode.parentClipId;
    const parentClipIdIsValid =
      rawParentClipId === undefined ||
      isValidMotionParentStableId(rawParentClipId);
    if (
      !clipId ||
      !compositionId ||
      (space !== '2d' && space !== '3d') ||
      !parentClipIdIsValid
    ) {
      hasStructurallyInvalidNode = true;
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        'Parent graph nodes require valid clip, composition, space, and optional parent ids.',
        clipId ? [clipId] : [],
      ));
      continue;
    }
    const node: MotionParentGraphNode = {
      clipId,
      compositionId,
      space,
      ...(typeof rawParentClipId === 'string' ? { parentClipId: rawParentClipId } : {}),
    };
    if (
      previousClipId !== undefined &&
      node.clipId < previousClipId &&
      !graphOrderFailureEmitted
    ) {
      graphOrderFailureEmitted = true;
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.GRAPH_ORDER_INVALID,
        'Parent graph nodes must be in strictly ascending clip-id order.',
        [previousClipId, node.clipId],
      ));
    }
    previousClipId = node.clipId;
    if (nodesById.has(node.clipId)) {
      hasStructurallyInvalidNode = true;
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.DUPLICATE_CLIP_ID,
        'Parent graph clip ids must be unique.',
        [node.clipId],
      ));
      continue;
    }
    nodesById.set(node.clipId, node);
    validNodes.push(node);
  }

  for (const node of validNodes) {
    if (!node.parentClipId) continue;
    if (node.parentClipId === node.clipId) {
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.SELF_PARENT,
        'A clip cannot parent itself.',
        [node.clipId],
      ));
      continue;
    }
    const parent = nodesById.get(node.parentClipId);
    if (!parent) {
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
        'The requested parent is not present in the parent graph.',
        [node.clipId, node.parentClipId],
      ));
      continue;
    }
    if (node.compositionId !== parent.compositionId) {
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH,
        'Parent and child must belong to the same composition.',
        [node.clipId, parent.clipId],
      ));
    }
    if (node.space !== '2d' || parent.space !== '2d') {
      failures.push(failure(
        MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
        'Structure 1.0 only supports 2D-to-2D parent relationships.',
        [node.clipId, parent.clipId],
      ));
    }
  }

  const completed = new Set<string>();
  const depthById = new Map<string, number>();
  const cycleKeys = new Set<string>();
  let depthBudgetFailureEmitted = false;
  for (const startClipId of [...nodesById.keys()].sort()) {
    if (completed.has(startClipId)) continue;
    const path: string[] = [];
    const pathIndexById = new Map<string, number>();
    let currentClipId: string | undefined = startClipId;
    while (
      currentClipId &&
      nodesById.has(currentClipId) &&
      !completed.has(currentClipId)
    ) {
      const cycleStartIndex = pathIndexById.get(currentClipId);
      if (cycleStartIndex !== undefined) {
        const cycleIds = path.slice(cycleStartIndex).sort();
        const cycleKey = cycleIds.join('\u0000');
        if (!cycleKeys.has(cycleKey)) {
          cycleKeys.add(cycleKey);
          failures.push(failure(
            MOTION_PARENT_ERROR_CODES.CYCLE,
            'The requested parent relationship would create a cycle.',
            cycleIds,
          ));
        }
        break;
      }
      pathIndexById.set(currentClipId, path.length);
      path.push(currentClipId);
      currentClipId = nodesById.get(currentClipId)?.parentClipId;
    }
    let inheritedDepth = currentClipId ? (depthById.get(currentClipId) ?? 0) : 0;
    for (let pathIndex = path.length - 1; pathIndex >= 0; pathIndex -= 1) {
      inheritedDepth += 1;
      const clipId = path[pathIndex];
      depthById.set(clipId, inheritedDepth);
      if (
        inheritedDepth > MOTION_PARENT_GRAPH_BUDGETS.maxDepth &&
        !depthBudgetFailureEmitted
      ) {
        depthBudgetFailureEmitted = true;
        failures.push(failure(
          MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED,
          'Parent graph exceeds the hard relationship-depth budget.',
          path,
        ));
      }
    }
    path.forEach((clipId) => completed.add(clipId));
  }

  const expectedRevision = calculateMotionParentGraphRevision(validNodes);
  if (
    !hasStructurallyInvalidNode &&
    (graphValue.version !== MOTION_PARENT_GRAPH_CONTRACT_VERSION || graphValue.revision !== expectedRevision)
  ) {
    failures.push(failure(
      MOTION_PARENT_ERROR_CODES.REVISION_MISMATCH,
      'The parent graph revision does not match its canonical contents.',
      validNodes.map((node) => node.clipId),
    ));
  }

  return failures;
}

interface WorldEvaluationResult {
  readonly worlds?: ReadonlyMap<string, MotionParentTransform2D>;
  readonly failures: readonly MotionParentFailure[];
}

/** Evaluates the graph solely from the supplied explicit-time snapshot. */
export function evaluateMotionParentGraphWorldTransforms(
  graph: MotionParentGraphSnapshot,
  evaluation: MotionParentGraphEvaluation,
): WorldEvaluationResult {
  const graphFailures = validateMotionParentGraph(graph);
  if (graphFailures.length > 0) return { failures: graphFailures };

  const envelopeFailures = preflightParentEvaluationEnvelope(evaluation);
  if (envelopeFailures.length > 0) return { failures: envelopeFailures };

  const evaluationValue = evaluation as unknown as Record<string, unknown>;
  if (typeof evaluationValue.timelineTime !== 'number' || !Number.isFinite(evaluationValue.timelineTime)) {
    return {
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.INVALID_TIMELINE_TIME,
        'Parent evaluation requires an explicit finite timeline time.',
        [],
      )],
    };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.clipId, node]));
  const locals = new Map<string, MotionParentTransform2D>();
  const evaluationFailures: MotionParentFailure[] = [];
  const seenEvaluationIds = new Set<string>();
  const duplicateEvaluationIds = new Set<string>();
  let evaluationOrderFailureEmitted = false;
  let previousEvaluationClipId: string | undefined;
  for (const rawEntry of evaluation.localTransforms) {
    if (!isRecord(rawEntry) || !isValidMotionParentStableId(rawEntry.clipId)) {
      evaluationFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
        'Each evaluated transform requires a non-empty clip id and transform object.',
        [],
      ));
      continue;
    }
    const clipId = rawEntry.clipId;
    if (seenEvaluationIds.has(clipId)) {
      if (!duplicateEvaluationIds.has(clipId)) {
        duplicateEvaluationIds.add(clipId);
        evaluationFailures.push(failure(
          MOTION_PARENT_ERROR_CODES.DUPLICATE_EVALUATION,
          'Each clip may appear only once in an explicit-time transform evaluation.',
          [clipId],
        ));
      }
      continue;
    }
    seenEvaluationIds.add(clipId);
    if (
      previousEvaluationClipId !== undefined &&
      clipId < previousEvaluationClipId &&
      !evaluationOrderFailureEmitted
    ) {
      evaluationOrderFailureEmitted = true;
      evaluationFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
        'Evaluated transforms must be in strictly ascending clip-id order.',
        [previousEvaluationClipId, clipId],
      ));
    }
    previousEvaluationClipId = clipId;
    if (!nodesById.has(clipId)) {
      evaluationFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_INVALID,
        'Evaluation clip ids must exactly match the parent graph node ids.',
        [clipId],
      ));
      continue;
    }
    if (!isFiniteMotionParentTransform2D(rawEntry.transform as MotionParentTransform2D)) {
      evaluationFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM,
        'Evaluated parent transforms must contain only finite values.',
        [clipId],
      ));
      continue;
    }
    locals.set(
      clipId,
      cloneMotionParentTransform2D(rawEntry.transform as MotionParentTransform2D),
    );
  }
  for (const node of graph.nodes) {
    if (!locals.has(node.clipId)) {
      evaluationFailures.push(failure(
        MOTION_PARENT_ERROR_CODES.EVALUATION_MISSING,
        'Every graph node requires a local transform evaluated at the explicit timeline time.',
        [node.clipId],
      ));
    }
  }
  if (evaluationFailures.length > 0) return { failures: evaluationFailures };

  const worlds = new Map<string, MotionParentTransform2D>();
  const childrenByParentId = new Map<string, string[]>();
  const rootClipIds: string[] = [];
  for (const node of graph.nodes) {
    if (!node.parentClipId) {
      rootClipIds.push(node.clipId);
      continue;
    }
    const children = childrenByParentId.get(node.parentClipId) ?? [];
    children.push(node.clipId);
    childrenByParentId.set(node.parentClipId, children);
  }
  rootClipIds.sort();
  childrenByParentId.forEach((children) => children.sort());

  const queue: string[] = [];
  for (const rootClipId of rootClipIds) {
    worlds.set(rootClipId, cloneMotionParentTransform2D(locals.get(rootClipId)!));
    queue.push(rootClipId);
  }
  const derivedFailures: MotionParentFailure[] = [];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const parentClipId = queue[queueIndex];
    const parentWorld = worlds.get(parentClipId)!;
    for (const childClipId of childrenByParentId.get(parentClipId) ?? []) {
      const world = composeMotionParentTransforms2D(
        parentWorld,
        locals.get(childClipId)!,
      );
      if (!isFiniteMotionParentTransform2D(world)) {
        derivedFailures.push(failure(
          MOTION_PARENT_ERROR_CODES.NON_FINITE_TRANSFORM,
          'Composed world-transform evaluation overflowed to a non-finite value.',
          [childClipId, parentClipId],
        ));
        continue;
      }
      worlds.set(childClipId, world);
      queue.push(childClipId);
    }
  }
  if (derivedFailures.length > 0) return { failures: derivedFailures };
  return { worlds, failures: [] };
}

function collectAffectedClipIds(
  graph: MotionParentGraphSnapshot,
  rootClipId: string,
): string[] {
  const affected = new Set([rootClipId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.parentClipId && affected.has(node.parentClipId) && !affected.has(node.clipId)) {
        affected.add(node.clipId);
        changed = true;
      }
    }
  }
  return [...affected].sort();
}

function replaceParent(
  graph: MotionParentGraphSnapshot,
  childClipId: string,
  parentClipId: string | undefined,
): MotionParentGraphSnapshot {
  return createMotionParentGraphSnapshot(graph.nodes.map((node) => (
    node.clipId === childClipId
      ? {
          clipId: node.clipId,
          compositionId: node.compositionId,
          space: node.space,
          ...(parentClipId ? { parentClipId } : {}),
        }
      : node
  )));
}

export interface PlanMotionParentMutationInput {
  readonly graph: MotionParentGraphSnapshot;
  readonly evaluation: MotionParentGraphEvaluation;
  readonly childClipId: string;
  readonly parentClipId?: string;
}

export function planMotionParentMutation(
  input: PlanMotionParentMutationInput,
): MotionParentPlanResult {
  const inputFailures = preflightParentMutationInput(input);
  if (inputFailures.length > 0) return { ok: false, failures: inputFailures };

  const graphFailures = validateMotionParentGraph(input.graph);
  if (graphFailures.length > 0) return { ok: false, failures: graphFailures };

  const previousGraph = createMotionParentGraphSnapshot(input.graph.nodes);

  const nodesById = new Map(previousGraph.nodes.map((node) => [node.clipId, node]));
  const child = nodesById.get(input.childClipId);
  if (!child) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.CHILD_MISSING,
        'The requested child is not present in the parent graph.',
        [input.childClipId],
      )],
    };
  }
  if (input.parentClipId === input.childClipId) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.SELF_PARENT,
        'A clip cannot parent itself.',
        [input.childClipId],
      )],
    };
  }
  const parent = input.parentClipId ? nodesById.get(input.parentClipId) : undefined;
  if (input.parentClipId && !parent) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.PARENT_MISSING,
        'The requested parent is not present in the parent graph.',
        [input.childClipId, input.parentClipId],
      )],
    };
  }
  if (child.parentClipId === input.parentClipId) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.RELATIONSHIP_UNCHANGED,
        'The requested parent relationship already exists.',
        [input.childClipId, ...(input.parentClipId ? [input.parentClipId] : [])],
      )],
    };
  }
  if (parent && child.compositionId !== parent.compositionId) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH,
        'Parent and child must belong to the same composition.',
        [child.clipId, parent.clipId],
      )],
    };
  }
  if (parent && (child.space !== '2d' || parent.space !== '2d')) {
    return {
      ok: false,
      failures: [failure(
        MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED,
        'Structure 1.0 only supports 2D-to-2D parent relationships.',
        [child.clipId, parent.clipId],
      )],
    };
  }

  const nextGraph = replaceParent(previousGraph, child.clipId, input.parentClipId);
  const candidateFailures = validateMotionParentGraph(nextGraph);
  if (candidateFailures.length > 0) return { ok: false, failures: candidateFailures };

  const worldEvaluation = evaluateMotionParentGraphWorldTransforms(previousGraph, input.evaluation);
  if (!worldEvaluation.worlds) return { ok: false, failures: worldEvaluation.failures };
  const childWorld = worldEvaluation.worlds.get(child.clipId)!;
  const fromLocal = input.evaluation.localTransforms.find((entry) => entry.clipId === child.clipId)!.transform;

  let toLocal = cloneMotionParentTransform2D(childWorld);
  if (parent) {
    const parentWorld = worldEvaluation.worlds.get(parent.clipId)!;
    const inverse = deriveMotionParentLocalTransform2D(
      parentWorld,
      childWorld,
      [child.clipId, parent.clipId],
    );
    if (!inverse.ok) return { ok: false, failures: [inverse.failure] };
    toLocal = inverse.transform;
  }

  const kind: MotionParentMutationKind = child.parentClipId
    ? (input.parentClipId ? 'reparent' : 'clear')
    : 'set';
  const forwardChange: MotionParentRelationshipChange = {
    clipId: child.clipId,
    ...(child.parentClipId ? { fromParentClipId: child.parentClipId } : {}),
    ...(input.parentClipId ? { toParentClipId: input.parentClipId } : {}),
    fromLocalTransform: cloneMotionParentTransform2D(fromLocal),
    toLocalTransform: cloneMotionParentTransform2D(toLocal),
  };
  const undoChange: MotionParentRelationshipChange = {
    clipId: child.clipId,
    ...(input.parentClipId ? { fromParentClipId: input.parentClipId } : {}),
    ...(child.parentClipId ? { toParentClipId: child.parentClipId } : {}),
    fromLocalTransform: cloneMotionParentTransform2D(toLocal),
    toLocalTransform: cloneMotionParentTransform2D(fromLocal),
  };

  return {
    ok: true,
    failures: [],
    plan: {
      contractVersion: MOTION_PARENT_GRAPH_CONTRACT_VERSION,
      kind,
      timelineTime: input.evaluation.timelineTime,
      preservation: MOTION_PARENT_WORLD_PRESERVATION,
      affectedClipIds: collectAffectedClipIds(nextGraph, child.clipId),
      childWorldTransformAtOperationTime: cloneMotionParentTransform2D(childWorld),
      apply: {
        expectedRevision: previousGraph.revision,
        nextRevision: nextGraph.revision,
        graph: nextGraph,
        changes: [forwardChange],
      },
      undo: {
        expectedRevision: nextGraph.revision,
        nextRevision: previousGraph.revision,
        graph: previousGraph,
        changes: [undoChange],
      },
      history: {
        mode: 'single-entry',
        label: kind === 'set' ? 'Set Parent' : kind === 'clear' ? 'Clear Parent' : 'Reparent',
        atomic: true,
      },
    },
  };
}
