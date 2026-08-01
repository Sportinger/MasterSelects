import {
  MOTION_PARENT_ERROR_CODES,
  MOTION_PARENT_GRAPH_BUDGETS,
  type MotionParentErrorCode,
  type MotionParentFailure,
  type MotionParentGraphNode,
  type MotionParentGraphSnapshot,
} from './contracts';
import {
  createMotionParentGraphSnapshot,
  validateMotionParentGraph,
} from './parentGraphPlanner';
import { isValidMotionParentStableId } from './stableId';

export interface TimelineParentGraphClipLike {
  readonly id: string;
  readonly compositionId?: string;
  readonly parentClipId?: string;
  readonly is3D?: boolean;
}

export interface SanitizedTimelineParentClip {
  readonly id: string;
  readonly compositionId: string;
  readonly space: '2d' | '3d';
  readonly parentClipId?: string;
}

export interface SanitizedTimelineParentAssignment {
  readonly clipId: string;
  readonly parentClipId?: string;
}

export interface QuarantinedTimelineParentAssignment {
  readonly clipId: string;
  readonly parentClipId: string;
  readonly blockedBy: MotionParentErrorCode;
}

interface TimelineParentGraphSanitizationBase {
  readonly diagnostics: readonly MotionParentFailure[];
  readonly quarantinedClipIds: readonly string[];
  readonly quarantinedAssignments: readonly QuarantinedTimelineParentAssignment[];
}

export type TimelineParentGraphSanitizationResult =
  | TimelineParentGraphSanitizationBase & {
      readonly ok: true;
      readonly compositionId: string;
      readonly graph: MotionParentGraphSnapshot;
      readonly clips: readonly SanitizedTimelineParentClip[];
      readonly assignments: readonly SanitizedTimelineParentAssignment[];
    }
  | TimelineParentGraphSanitizationBase & {
      readonly ok: false;
      readonly clips: readonly [];
      readonly assignments: readonly [];
    };

interface InspectedClip {
  readonly id: string;
  readonly compositionId: string;
  readonly space: '2d' | '3d';
  readonly parentClipId?: string;
}

interface ClipInspectionResult {
  readonly clip?: InspectedClip;
  readonly diagnostic?: MotionParentFailure;
  readonly quarantinedClipId?: string;
  readonly quarantinedAssignment?: QuarantinedTimelineParentAssignment;
}

type DenseArrayInspection =
  | { readonly ok: true; readonly values: readonly unknown[] }
  | { readonly ok: false; readonly budgetExceeded: boolean };

const MALFORMED_NODE_MESSAGE =
  'Timeline parent data requires inert stable ids, an optional inert parent id, and a boolean 3D flag.';

function failure(
  code: MotionParentErrorCode,
  message: string,
  clipIds: readonly string[],
): MotionParentFailure {
  return { code, message, clipIds: [...new Set(clipIds)].sort(compareStrings) };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectDenseClipArray(value: unknown): DenseArrayInspection {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return { ok: false, budgetExceeded: false };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return { ok: false, budgetExceeded: false };
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && 'value' in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return { ok: false, budgetExceeded: false };
  }
  if (length > MOTION_PARENT_GRAPH_BUDGETS.maxNodes) {
    return { ok: false, budgetExceeded: true };
  }
  if (Reflect.ownKeys(value).some((key) => (
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

function dataDescriptorValue(
  descriptors: Readonly<Record<string, PropertyDescriptor>>,
  key: string,
): { readonly present: false } | { readonly present: true; readonly valid: boolean; readonly value?: unknown } {
  const descriptor = descriptors[key];
  if (!descriptor) return { present: false };
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return { present: true, valid: false };
  }
  return { present: true, valid: true, value: descriptor.value };
}

function inspectClip(value: unknown, expectedCompositionId: string): ClipInspectionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { diagnostic: failure(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID, MALFORMED_NODE_MESSAGE, []) };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return { diagnostic: failure(MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID, MALFORMED_NODE_MESSAGE, []) };
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const idDescriptor = dataDescriptorValue(descriptors, 'id');
  const candidateId = idDescriptor.present && idDescriptor.valid && isValidMotionParentStableId(idDescriptor.value)
    ? idDescriptor.value
    : undefined;
  const compositionDescriptor = dataDescriptorValue(descriptors, 'compositionId');
  const parentDescriptor = dataDescriptorValue(descriptors, 'parentClipId');
  const isThreeDDescriptor = dataDescriptorValue(descriptors, 'is3D');
  const compositionIsValid = !compositionDescriptor.present || (
    compositionDescriptor.valid &&
    isValidMotionParentStableId(compositionDescriptor.value) &&
    compositionDescriptor.value === expectedCompositionId
  );
  const isThreeDIsValid = !isThreeDDescriptor.present || (
    isThreeDDescriptor.valid &&
    typeof isThreeDDescriptor.value === 'boolean'
  );
  if (!candidateId || !compositionIsValid || !isThreeDIsValid) {
    return {
      diagnostic: failure(
        !compositionIsValid
          ? MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH
          : MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        !compositionIsValid
          ? 'Timeline parent data belongs to a different composition.'
          : MALFORMED_NODE_MESSAGE,
        candidateId ? [candidateId] : [],
      ),
      ...(candidateId ? { quarantinedClipId: candidateId } : {}),
    };
  }
  const space = isThreeDDescriptor.present && isThreeDDescriptor.value === true ? '3d' : '2d';

  let parentClipId: string | undefined;
  if (parentDescriptor.present) {
    if (!parentDescriptor.valid || (
      parentDescriptor.value !== undefined &&
      !isValidMotionParentStableId(parentDescriptor.value)
    )) {
      return {
        clip: {
          id: candidateId,
          compositionId: expectedCompositionId,
          space,
        },
        diagnostic: failure(
          MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
          MALFORMED_NODE_MESSAGE,
          [candidateId],
        ),
      };
    }
    if (typeof parentDescriptor.value === 'string') parentClipId = parentDescriptor.value;
  }

  return {
    clip: {
      id: candidateId,
      compositionId: expectedCompositionId,
      space,
      ...(parentClipId ? { parentClipId } : {}),
    },
  };
}

function canonicalDiagnostics(diagnostics: readonly MotionParentFailure[]): MotionParentFailure[] {
  const byKey = new Map<string, MotionParentFailure>();
  for (const diagnostic of diagnostics) {
    const canonical = failure(diagnostic.code, diagnostic.message, diagnostic.clipIds);
    const key = JSON.stringify([canonical.code, canonical.clipIds, canonical.message]);
    byKey.set(key, canonical);
  }
  return [...byKey.values()].sort((left, right) => (
    compareStrings(left.code, right.code) ||
    compareStrings(left.clipIds.join('\u0000'), right.clipIds.join('\u0000')) ||
    compareStrings(left.message, right.message)
  ));
}

function quarantineAssignment(
  node: MotionParentGraphNode,
  blockedBy: MotionParentErrorCode,
  target: Map<string, QuarantinedTimelineParentAssignment>,
): void {
  if (!node.parentClipId || target.has(node.clipId)) return;
  target.set(node.clipId, {
    clipId: node.clipId,
    parentClipId: node.parentClipId,
    blockedBy,
  });
}

function collectInvalidEdgeChildren(
  graph: MotionParentGraphSnapshot,
  failures: readonly MotionParentFailure[],
  quarantinedAssignments: Map<string, QuarantinedTimelineParentAssignment>,
): ReadonlySet<string> {
  const nodesById = new Map(graph.nodes.map((node) => [node.clipId, node]));
  const cleared = new Set<string>();
  for (const graphFailure of failures) {
    if (graphFailure.code === MOTION_PARENT_ERROR_CODES.SELF_PARENT) {
      for (const clipId of graphFailure.clipIds) {
        const node = nodesById.get(clipId);
        if (node && node.parentClipId === node.clipId) {
          cleared.add(node.clipId);
          quarantineAssignment(node, graphFailure.code, quarantinedAssignments);
        }
      }
      continue;
    }
    if (graphFailure.code === MOTION_PARENT_ERROR_CODES.PARENT_MISSING) {
      for (const node of graph.nodes) {
        if (node.parentClipId && !nodesById.has(node.parentClipId)) {
          cleared.add(node.clipId);
          quarantineAssignment(node, graphFailure.code, quarantinedAssignments);
        }
      }
      continue;
    }
    if (
      graphFailure.code === MOTION_PARENT_ERROR_CODES.MIXED_3D_UNSUPPORTED ||
      graphFailure.code === MOTION_PARENT_ERROR_CODES.COMPOSITION_MISMATCH
    ) {
      const failureIds = new Set(graphFailure.clipIds);
      for (const node of graph.nodes) {
        if (node.parentClipId && failureIds.has(node.clipId) && failureIds.has(node.parentClipId)) {
          cleared.add(node.clipId);
          quarantineAssignment(node, graphFailure.code, quarantinedAssignments);
        }
      }
      continue;
    }
    if (graphFailure.code === MOTION_PARENT_ERROR_CODES.CYCLE) {
      const cycleIds = new Set(graphFailure.clipIds);
      for (const node of graph.nodes) {
        if (node.parentClipId && cycleIds.has(node.clipId) && cycleIds.has(node.parentClipId)) {
          cleared.add(node.clipId);
          quarantineAssignment(node, graphFailure.code, quarantinedAssignments);
        }
      }
    }
  }
  return cleared;
}

function clearDepthOverflowEdges(
  nodes: readonly MotionParentGraphNode[],
  quarantinedAssignments: Map<string, QuarantinedTimelineParentAssignment>,
): MotionParentGraphNode[] {
  const childrenByParentId = new Map<string, string[]>();
  const nodesById = new Map(nodes.map((node) => [node.clipId, node]));
  const roots: string[] = [];
  for (const node of nodes) {
    if (!node.parentClipId) {
      roots.push(node.clipId);
      continue;
    }
    const children = childrenByParentId.get(node.parentClipId) ?? [];
    children.push(node.clipId);
    childrenByParentId.set(node.parentClipId, children);
  }
  roots.sort(compareStrings);
  for (const children of childrenByParentId.values()) children.sort(compareStrings);

  const cleared = new Set<string>();
  const queue = roots.map((clipId) => ({ clipId, depth: 1 }));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const childId of childrenByParentId.get(current.clipId) ?? []) {
      const child = nodesById.get(childId)!;
      if (current.depth >= MOTION_PARENT_GRAPH_BUDGETS.maxDepth) {
        cleared.add(childId);
        quarantineAssignment(
          child,
          MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED,
          quarantinedAssignments,
        );
        queue.push({ clipId: childId, depth: 1 });
      } else {
        queue.push({ clipId: childId, depth: current.depth + 1 });
      }
    }
  }
  return nodes.map((node) => cleared.has(node.clipId)
    ? { clipId: node.clipId, compositionId: node.compositionId, space: node.space }
    : node);
}

function sanitizedClipsFromGraph(graph: MotionParentGraphSnapshot): SanitizedTimelineParentClip[] {
  return graph.nodes.map((node) => ({
    id: node.clipId,
    compositionId: node.compositionId,
    space: node.space,
    ...(node.parentClipId ? { parentClipId: node.parentClipId } : {}),
  }));
}

function sanitizedAssignmentsFromGraph(
  graph: MotionParentGraphSnapshot,
): SanitizedTimelineParentAssignment[] {
  return graph.nodes.map((node) => ({
    clipId: node.clipId,
    ...(node.parentClipId ? { parentClipId: node.parentClipId } : {}),
  }));
}

/**
 * Projects TimelineClip-like parent fields into the frozen MD6 graph contract,
 * removes only invalid relationships, and never reads unrelated runtime fields.
 */
export function sanitizeTimelineParentGraph(
  compositionId: string,
  clips: readonly TimelineParentGraphClipLike[],
): TimelineParentGraphSanitizationResult {
  if (!isValidMotionParentStableId(compositionId)) {
    return {
      ok: false,
      clips: [],
      assignments: [],
      quarantinedClipIds: [],
      quarantinedAssignments: [],
      diagnostics: [failure(
        MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        'Timeline parent sanitization requires a stable composition id.',
        [],
      )],
    };
  }
  const array = inspectDenseClipArray(clips);
  if (!array.ok) {
    return {
      ok: false,
      clips: [],
      assignments: [],
      quarantinedClipIds: [],
      quarantinedAssignments: [],
      diagnostics: [failure(
        array.budgetExceeded
          ? MOTION_PARENT_ERROR_CODES.GRAPH_NODE_BUDGET_EXCEEDED
          : MOTION_PARENT_ERROR_CODES.GRAPH_NODE_INVALID,
        array.budgetExceeded
          ? 'Timeline parent data exceeds the frozen graph node budget.'
          : 'Timeline parent data must be a bounded native dense array.',
        [],
      )],
    };
  }

  const diagnostics: MotionParentFailure[] = [];
  const quarantinedClipIds = new Set<string>();
  const quarantinedAssignments = new Map<string, QuarantinedTimelineParentAssignment>();
  const inspectedClips: InspectedClip[] = [];
  for (const value of array.values) {
    const inspected = inspectClip(value, compositionId);
    if (inspected.diagnostic) diagnostics.push(inspected.diagnostic);
    if (inspected.quarantinedClipId) quarantinedClipIds.add(inspected.quarantinedClipId);
    if (inspected.quarantinedAssignment) {
      quarantinedAssignments.set(inspected.quarantinedAssignment.clipId, inspected.quarantinedAssignment);
    }
    if (inspected.clip) inspectedClips.push(inspected.clip);
  }

  const countsById = new Map<string, number>();
  for (const clip of inspectedClips) countsById.set(clip.id, (countsById.get(clip.id) ?? 0) + 1);
  for (const [clipId, count] of countsById) {
    if (count < 2) continue;
    quarantinedClipIds.add(clipId);
    diagnostics.push(failure(
      MOTION_PARENT_ERROR_CODES.DUPLICATE_CLIP_ID,
      'Parent graph clip ids must be unique.',
      [clipId],
    ));
  }

  const nodes = inspectedClips
    .filter((clip) => !quarantinedClipIds.has(clip.id))
    .map((clip) => ({
      clipId: clip.id,
      compositionId: clip.compositionId,
      space: clip.space,
      ...(clip.parentClipId ? { parentClipId: clip.parentClipId } : {}),
    } satisfies MotionParentGraphNode));
  let graph = createMotionParentGraphSnapshot(nodes);
  const initialFailures = validateMotionParentGraph(graph);
  diagnostics.push(...initialFailures);
  const invalidEdgeChildren = collectInvalidEdgeChildren(
    graph,
    initialFailures,
    quarantinedAssignments,
  );
  if (invalidEdgeChildren.size > 0) {
    graph = createMotionParentGraphSnapshot(graph.nodes.map((node) => (
      invalidEdgeChildren.has(node.clipId)
        ? { clipId: node.clipId, compositionId: node.compositionId, space: node.space }
        : node
    )));
  }

  const postRelationshipFailures = validateMotionParentGraph(graph);
  diagnostics.push(...postRelationshipFailures);
  if (postRelationshipFailures.some(
    (item) => item.code === MOTION_PARENT_ERROR_CODES.GRAPH_DEPTH_BUDGET_EXCEEDED,
  )) {
    graph = createMotionParentGraphSnapshot(clearDepthOverflowEdges(
      graph.nodes,
      quarantinedAssignments,
    ));
  }

  const finalFailures = validateMotionParentGraph(graph);
  if (finalFailures.length > 0) {
    return {
      ok: false,
      clips: [],
      assignments: [],
      quarantinedClipIds: [...quarantinedClipIds].sort(compareStrings),
      quarantinedAssignments: [...quarantinedAssignments.values()].sort((left, right) => (
        compareStrings(left.clipId, right.clipId)
      )),
      diagnostics: canonicalDiagnostics([...diagnostics, ...finalFailures]),
    };
  }

  return {
    ok: true,
    compositionId,
    graph,
    clips: sanitizedClipsFromGraph(graph),
    assignments: sanitizedAssignmentsFromGraph(graph),
    quarantinedClipIds: [...quarantinedClipIds].sort(compareStrings),
    quarantinedAssignments: [...quarantinedAssignments.values()].sort((left, right) => (
      compareStrings(left.clipId, right.clipId)
    )),
    diagnostics: canonicalDiagnostics(diagnostics),
  };
}
