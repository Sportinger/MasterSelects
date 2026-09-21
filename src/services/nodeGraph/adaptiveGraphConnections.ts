import type { NodeConnectionVariant, NodeGraphConnectionRequest, NodeGraphPort } from '../../types/nodeGraph';
import { checkGraphConnection, nodePortsCompatible, type ConnectionCheck, type ConnectionGraph } from './graphConnections';

type GraphNode = ConnectionGraph['nodes'][number];
type GraphEdge = ConnectionGraph['edges'][number];
export type AdaptiveConnectionResult = { ok: true; graph: ConnectionGraph; connection: NodeGraphConnectionRequest;
  variants: ReadonlyMap<string, string>; replacesEdgeId?: string } | Extract<ConnectionCheck, { ok: false }>;

/** Port positions are roles within an explicitly adaptive family (A, B, result).
 * Actual saved port IDs remain those of the selected executable variant. */
function mappedPort(node: GraphNode, variant: NodeConnectionVariant, id: string, direction: 'inputs' | 'outputs') {
  if (id.startsWith('group-')) return node[direction].find(port => port.id === id);
  const index = node[direction].findIndex(port => port.id === id);
  return index < 0 ? undefined : variant[direction][index];
}

function currentVariant(node: GraphNode): NodeConnectionVariant {
  return { operatorId: node.operatorId ?? '', inputs: node.inputs, outputs: node.outputs };
}

/** A bounded constraint solve, only on the connected adaptive component. No
 * conversions, lossy casts, dropped cables or speculative shader variants. */
export function resolveAdaptiveGraphConnection(graph: ConnectionGraph, connection: NodeGraphConnectionRequest,
  ignoreEdgeId?: string): AdaptiveConnectionResult {
  const direct = checkGraphConnection(graph, connection, ignoreEdgeId);
  if (direct.ok) return { ...direct, graph, connection, variants: new Map() };
  if (direct.code !== 'type-mismatch') return direct;
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const target = nodes.get(connection.toNodeId)!;
  const input = target.inputs.find(port => port.id === connection.toPortId)!;
  const replaced = input.metadata?.repeated ? undefined : graph.edges.find(edge => edge.id !== ignoreEdgeId
    && edge.toNodeId === connection.toNodeId && edge.toPortId === connection.toPortId);
  if (replaced?.readOnly) return { ok: false, code: 'read-only', message: 'This input has a recorded dependency.' };
  const edges: GraphEdge[] = [...graph.edges.filter(edge => edge.id !== ignoreEdgeId && edge !== replaced), { ...connection, id: '@new-connection' }];
  const adjacent = new Map<string, GraphEdge[]>();
  for (const edge of edges) for (const id of [edge.fromNodeId, edge.toNodeId]) {
    const list = adjacent.get(id) ?? []; list.push(edge); adjacent.set(id, list);
  }
  const pending = [connection.toNodeId, connection.fromNodeId], affected = new Set<string>(), constraints = new Set<GraphEdge>();
  while (pending.length) {
    const id = pending.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const edge of adjacent.get(id) ?? []) {
      constraints.add(edge);
      const other = edge.fromNodeId === id ? edge.toNodeId : edge.fromNodeId;
      if (nodes.get(other)?.connectionVariants?.length) pending.push(other);
    }
  }
  const choices = new Map<string, NodeConnectionVariant[]>();
  for (const edge of constraints) for (const id of [edge.fromNodeId, edge.toNodeId]) {
    if (choices.has(id)) continue;
    const node = nodes.get(id);
    if (!node) return { ok: false, code: 'missing-node', message: 'Connection endpoint node does not exist.' };
    const variants = affected.has(id) ? node.connectionVariants ?? [] : [];
    choices.set(id, [currentVariant(node), ...variants.filter(v => v.operatorId !== node.operatorId)]);
  }
  const compatible = (edge: GraphEdge, from: NodeConnectionVariant, to: NodeConnectionVariant) => {
    const source = nodes.get(edge.fromNodeId)!, destination = nodes.get(edge.toNodeId)!;
    const output = mappedPort(source, from, edge.fromPortId, 'outputs');
    const inputPort = mappedPort(destination, to, edge.toPortId, 'inputs');
    if (!output || !inputPort) return false;
    // Existing read-only boundary ports are fixed and must not be remapped.
    if (edge.readOnly || output.metadata?.readOnly || inputPort.metadata?.readOnly) {
      return from.operatorId === (source.operatorId ?? '') && to.operatorId === (destination.operatorId ?? '');
    }
    return nodePortsCompatible(output, inputPort);
  };
  let attempts = 0;
  const solve = (domains: Map<string, NodeConnectionVariant[]>): Map<string, NodeConnectionVariant[]> | undefined => {
    if (++attempts > 512) return;
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of constraints) {
        const from = domains.get(edge.fromNodeId)!, to = domains.get(edge.toNodeId)!;
        const a = from.filter(source => to.some(destination => compatible(edge, source, destination)));
        const b = to.filter(destination => a.some(source => compatible(edge, source, destination)));
        if (!a.length || !b.length) return;
        if (a.length !== from.length || b.length !== to.length) changed = true;
        domains.set(edge.fromNodeId, a); domains.set(edge.toNodeId, b);
      }
    }
    // Keep the dragged source's type if possible, then keep existing variants.
    const undecided = [...domains].filter(([, values]) => values.length > 1)
      .toSorted(([a, av], [b, bv]) => a === connection.fromNodeId ? -1 : b === connection.fromNodeId ? 1 : av.length - bv.length)[0];
    if (!undecided) return domains;
    for (const choice of undecided[1]) {
      const branch = new Map(domains); branch.set(undecided[0], [choice]);
      const result = solve(branch); if (result) return result;
    }
  };
  const solution = solve(choices);
  if (!solution) return { ok: false, code: 'type-mismatch', message: 'No supported variant preserves the connected signal types. Use an explicit conversion or disconnect conflicting inputs.' };
  const variants = new Map<string, string>();
  for (const [id, [variant]] of solution) if (variant.operatorId !== (nodes.get(id)!.operatorId ?? '')) variants.set(id, variant.operatorId);
  const remap = (edge: NodeGraphConnectionRequest): NodeGraphConnectionRequest => {
    const portId = (id: string, port: string, direction: 'inputs' | 'outputs') => {
      const choice = solution.get(id)?.[0];
      return choice ? mappedPort(nodes.get(id)!, choice, port, direction)?.id ?? port : port;
    };
    return { ...edge, fromPortId: portId(edge.fromNodeId, edge.fromPortId, 'outputs'), toPortId: portId(edge.toNodeId, edge.toPortId, 'inputs') };
  };
  // Retain boundary/view metadata on unchanged ports, including animation bindings.
  const projectPorts = (node: GraphNode, variant: NodeConnectionVariant, direction: 'inputs' | 'outputs'): readonly NodeGraphPort[] =>
    [...variant[direction].map((port, index) => ({ ...port, metadata: { ...node[direction][index]?.metadata, ...port.metadata } })),
      ...node[direction].filter(port => port.id.startsWith('group-'))];
  const resolved: ConnectionGraph = { nodes: graph.nodes.map(node => {
    const variant = solution.get(node.id)?.[0];
    return !variant || !variants.has(node.id) ? node : { ...node, operatorId: variant.operatorId,
      inputs: projectPorts(node, variant, 'inputs'), outputs: projectPorts(node, variant, 'outputs') };
  }), edges: graph.edges.filter(edge => edge.id !== ignoreEdgeId && edge !== replaced).map(edge => ({ ...edge, ...remap(edge) })) };
  const nextConnection = remap(connection);
  const check = checkGraphConnection(resolved, nextConnection);
  return check.ok ? { ok: true, graph: resolved, connection: nextConnection, variants, ...(replaced ? { replacesEdgeId: replaced.id } : {}) } : check;
}
