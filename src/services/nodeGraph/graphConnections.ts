import type { NodeGraphConnectionRequest, NodeGraphEdge, NodeGraphPort } from '../../types/nodeGraph';

/** The workspace contract is also the editing contract. Domain adapters supply
 * ports/endpoints from their saved owners; this module never stores a graph. */
export interface ConnectionGraph {
  nodes: readonly { id: string; inputs: readonly NodeGraphPort[]; outputs: readonly NodeGraphPort[] }[];
  edges: readonly (NodeGraphConnectionRequest & { id: string; readOnly?: boolean })[];
}

export type ConnectionCheck =
  | { ok: true; replacesEdgeId?: string }
  | { ok: false; code: 'self-link' | 'missing-node' | 'missing-port' | 'read-only' | 'type-mismatch' | 'duplicate-edge' | 'cycle'; message: string };

export function getNodeGraphPortCompatibilityKey(port: Pick<NodeGraphPort, 'type' | 'metadata'>): string {
  const semantic = port.metadata?.semanticKind;
  return semantic?.startsWith('flock:') || semantic?.startsWith('operator:') ? semantic : port.type;
}

export function formatsOverlap(a?: readonly string[], b?: readonly string[]): boolean {
  return !a?.length || !b?.length || a.some(format => b.includes(format));
}

export function nodePortsCompatible(output: NodeGraphPort, input: NodeGraphPort): boolean {
  return output.direction === 'output' && input.direction === 'input'
    && !output.metadata?.readOnly && !input.metadata?.readOnly
    && getNodeGraphPortCompatibilityKey(output) === getNodeGraphPortCompatibilityKey(input)
    && formatsOverlap(output.metadata?.contract?.formats, input.metadata?.contract?.formats);
}

export function sameConnection(a: NodeGraphConnectionRequest, b: NodeGraphConnectionRequest): boolean {
  return a.fromNodeId === b.fromNodeId && a.fromPortId === b.fromPortId
    && a.toNodeId === b.toNodeId && a.toPortId === b.toPortId;
}

export function wouldCreateGraphCycle(edges: readonly Pick<NodeGraphEdge, 'fromNodeId' | 'toNodeId'>[], from: string, to: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.fromNodeId) ?? [];
    targets.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, targets);
  }
  const pending = [to], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === from) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  return false;
}

/** Replacement and reconnection are checked against the resulting topology,
 * excluding the old cable. Rejected edits never remove the original cable. */
export function checkGraphConnection(graph: ConnectionGraph, connection: NodeGraphConnectionRequest, ignoreEdgeId?: string): ConnectionCheck {
  const fail = (code: Extract<ConnectionCheck, { ok: false }>['code'], message: string): ConnectionCheck => ({ ok: false, code, message });
  if (connection.fromNodeId === connection.toNodeId) return fail('self-link', 'A node cannot connect to itself.');
  const source = graph.nodes.find(node => node.id === connection.fromNodeId);
  const target = graph.nodes.find(node => node.id === connection.toNodeId);
  if (!source || !target) return fail('missing-node', 'Connection endpoint node does not exist.');
  const output = source.outputs.find(port => port.id === connection.fromPortId);
  const input = target.inputs.find(port => port.id === connection.toPortId);
  if (!output || !input) return fail('missing-port', `Port ${!output ? connection.fromPortId : connection.toPortId} does not exist.`);
  if (output.metadata?.readOnly || input.metadata?.readOnly || graph.edges.some(edge => edge.id === ignoreEdgeId && edge.readOnly)) {
    return fail('read-only', 'This connection is a recorded dependency.');
  }
  if (!nodePortsCompatible(output, input)) return fail('type-mismatch', 'The port signal types or formats do not match.');
  const edges = graph.edges.filter(edge => edge.id !== ignoreEdgeId);
  if (edges.some(edge => sameConnection(edge, connection))) return fail('duplicate-edge', 'These ports are already connected.');
  const occupying = input.metadata?.repeated ? undefined
    : edges.find(edge => edge.toNodeId === connection.toNodeId && edge.toPortId === connection.toPortId);
  if (occupying?.readOnly) return fail('read-only', 'This input has a recorded dependency.');
  if (wouldCreateGraphCycle(edges.filter(edge => edge !== occupying), connection.fromNodeId, connection.toNodeId)) {
    return fail('cycle', 'This connection would create a cycle.');
  }
  return occupying ? { ok: true, replacesEdgeId: occupying.id } : { ok: true };
}

/** Iterative cycle detection; no call-stack limit for imported graphs. */
export function graphHasCycle(nodes: readonly { id: string }[], edges: readonly Pick<NodeGraphEdge, 'fromNodeId' | 'toNodeId'>[]): boolean {
  const degree = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!degree.has(edge.fromNodeId) || !degree.has(edge.toNodeId)) continue;
    degree.set(edge.toNodeId, degree.get(edge.toNodeId)! + 1);
    const targets = outgoing.get(edge.fromNodeId) ?? [];
    targets.push(edge.toNodeId); outgoing.set(edge.fromNodeId, targets);
  }
  const ready = [...degree.keys()].filter(id => degree.get(id) === 0);
  for (let i = 0; i < ready.length; i++) for (const id of outgoing.get(ready[i]) ?? []) {
    degree.set(id, degree.get(id)! - 1);
    if (degree.get(id) === 0) ready.push(id);
  }
  return ready.length !== degree.size;
}
