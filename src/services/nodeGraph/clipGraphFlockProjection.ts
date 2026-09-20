import { projectFlockPort } from '../flock/graph/flockConnectionGraph';
export { getNodeGraphPortCompatibilityKey } from './graphConnections';
import type {
  FlockDefinition,
  FlockNode,
  FlockParamValue,
  FlockPortType,
} from '../../types/flock';
import { compileFlockDefinitionCached } from '../flock/compiler/flockCompiler';
import {
  FLOCK_GROUP_OPERATOR_ID,
  getFlockOperator,
  resolveFlockNodePorts,
} from '../flock/operators/flockOperatorRegistry';
import {
  FLOCK_CATEGORY_LABELS,
  type FlockOperatorCategory,
} from '../flock/operators/flockOperatorTypes';
import type { TimelineClip } from './clipGraphProjectionDomain';
import type {
  ClipCustomNodeParamValue,
  NodeGraph,
  NodeGraphEdge,
  NodeGraphNode,
  NodeGraphNodeKind,
  NodeGraphPort,
} from './types';

/**
 * Flock view projection. The clip's FlockDefinition stays the only
 * authoritative graph; this module derives a read-only NodeGraph for the
 * shared canvas. Edits go through the timeline store's flock actions.
 */

export const FLOCK_PORT_SEMANTIC_PREFIX = 'flock:';

const KIND_BY_CATEGORY: Record<FlockOperatorCategory, NodeGraphNodeKind> = {
  population: 'source',
  behavior: 'effect',
  guidance: 'transform',
  selection: 'mask',
  values: 'analysis',
  simulation: 'motion',
  render: 'color',
  output: 'output',
  groups: 'custom',
};

export function getClipFlockGraphId(clipId: string): string {
  return `clip-graph:${clipId}:flock`;
}

export function clipSupportsFlockGraph(clip: Pick<TimelineClip, 'source' | 'flock'>): boolean {
  return clip.source?.type === 'flock' && !!clip.flock;
}

export function flockPortSemanticKind(type: FlockPortType): string {
  return `${FLOCK_PORT_SEMANTIC_PREFIX}${type}`;
}

/** Flock port type carried by a projected port, or null for non-flock ports. */
export function getFlockPortType(port: Pick<NodeGraphPort, 'metadata'>): FlockPortType | null {
  const semantic = port.metadata?.semanticKind;
  return typeof semantic === 'string' && semantic.startsWith(FLOCK_PORT_SEMANTIC_PREFIX)
    ? semantic.slice(FLOCK_PORT_SEMANTIC_PREFIX.length) as FlockPortType
    : null;
}

/** Display params: vec3 values flatten to `param.x/.y/.z`; canonical values stay in the definition. */
export function flattenFlockParams(params: Record<string, FlockParamValue>): Record<string, ClipCustomNodeParamValue> {
  const result: Record<string, ClipCustomNodeParamValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      result[`${key}.x`] = value[0];
      result[`${key}.y`] = value[1];
      result[`${key}.z`] = value[2];
    } else {
      result[key] = value;
    }
  }
  return result;
}

interface FlockDiagnosticCounts {
  errors: number;
  warnings: number;
}

function countDiagnosticsByNode(definition: FlockDefinition): Map<string, FlockDiagnosticCounts> {
  const counts = new Map<string, FlockDiagnosticCounts>();
  for (const diagnostic of compileFlockDefinitionCached(definition).diagnostics) {
    if (diagnostic.severity === 'info') continue;
    for (const nodeId of new Set(diagnostic.nodeIds ?? [])) {
      const entry = counts.get(nodeId) ?? { errors: 0, warnings: 0 };
      if (diagnostic.severity === 'error') entry.errors += 1; else entry.warnings += 1;
      counts.set(nodeId, entry);
    }
  }
  return counts;
}

function buildFlockGraphNode(
  graphId: string,
  definition: FlockDefinition,
  node: FlockNode,
  counts: FlockDiagnosticCounts | undefined,
): NodeGraphNode {
  const isGroup = node.operator === FLOCK_GROUP_OPERATOR_ID;
  const operator = getFlockOperator(node.operator);
  const group = isGroup ? definition.groups.find((candidate) => candidate.id === node.groupRef) : undefined;
  const ports = resolveFlockNodePorts(node, definition);
  const category: FlockOperatorCategory = operator?.category ?? 'groups';
  const label = node.label ?? (isGroup ? group?.label : operator?.label) ?? node.operator;
  const description = isGroup
    ? group
      ? `Group of ${group.nodes.length} node${group.nodes.length === 1 ? '' : 's'}`
      : `Missing group definition ${node.groupRef ?? ''}`.trim()
    : operator?.description ?? `Unsupported operator ${node.operator} (kept unchanged)`;

  return {
    id: node.id,
    operatorId: operator?.sharedOperator ?? node.operator,
    kind: KIND_BY_CATEGORY[category],
    runtime: isGroup ? 'subgraph' : 'wgsl',
    label,
    description,
    inputs: (ports?.inputs ?? []).map((port) => projectFlockPort(port, 'input')),
    outputs: (ports?.outputs ?? []).map((port) => projectFlockPort(port, 'output')),
    params: {
      ...flattenFlockParams(node.params),
      operator: node.operator,
      operatorVersion: node.operatorVersion,
      category,
      categoryLabel: FLOCK_CATEGORY_LABELS[category],
      bypassed: node.bypassed === true,
      // A bypassed group instance mutes all of its outputs.
      bypassable: isGroup || (!!operator && operator.bypass.kind !== 'none'),
      flockErrors: counts?.errors ?? 0,
      flockWarnings: counts?.warnings ?? 0,
      ...(node.groupRef ? { groupRef: node.groupRef } : {}),
    },
    layout: { ...(definition.layout[node.id] ?? { x: 0, y: 0 }) },
    domain: 'flock',
    binding: { kind: 'flock-node', nodeId: node.id, operator: node.operator },
    ...(isGroup && node.groupRef ? { subgraphId: `${graphId}:group:${node.groupRef}` } : {}),
  };
}

export function buildClipFlockNodeGraph(clip: TimelineClip): NodeGraph | null {
  if (!clipSupportsFlockGraph(clip)) return null;
  const definition = clip.flock!;
  const graphId = getClipFlockGraphId(clip.id);
  const counts = countDiagnosticsByNode(definition);
  const nodes = definition.nodes.map((node) => buildFlockGraphNode(graphId, definition, node, counts.get(node.id)));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges: NodeGraphEdge[] = definition.edges.map((edge) => {
    const sourcePort = nodesById.get(edge.from.nodeId)?.outputs.find((port) => port.id === edge.from.port);
    return {
      id: edge.id,
      fromNodeId: edge.from.nodeId,
      fromPortId: edge.from.port,
      toNodeId: edge.to.nodeId,
      toPortId: edge.to.port,
      type: sourcePort?.type ?? 'metadata',
    };
  });

  return {
    id: graphId,
    owner: { kind: 'clip', id: clip.id, name: clip.name },
    nodes,
    edges,
    domain: 'flock',
  };
}
