import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorParameter, OperatorPort } from '../../types/operatorGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { getOperatorComposition } from '../operators/operatorCompositionRegistry';
import { compositionNodeIds } from '../operators/operatorComposition';

/**
 * Agent-facing view of an editable graph. Expanded compounds are folded back
 * into one node with their public ports (the IDs `connect`/`remove` accept),
 * and ports/parameters are one-line strings instead of full contracts. A
 * single compound can otherwise contribute ~50 internal nodes to a tool result.
 */
export function foldCompoundsForAgent(graph: EffectOperatorGraph): EffectOperatorGraph {
  const groups = graph.groups ?? [];
  const byId = new Map(groups.map(group => [group.id, group]));
  const insideCompound = (parentId?: string): boolean => {
    for (let id = parentId; id; id = byId.get(id)?.parentId) if (byId.get(id)?.composition) return true;
    return false;
  };
  const compounds = groups.filter(group => group.composition && !insideCompound(group.parentId));
  if (!compounds.length) return graph;
  const members = new Map<string, string>();
  const inputs = new Map<string, { node: string; port: string }>();
  const outputs = new Map<string, { node: string; port: string }>();
  const folded: BoundOperatorNode[] = [];
  const layout = { ...graph.layout };
  for (const group of compounds) {
    const instance = group.composition!.instance, definition = getOperatorComposition(instance.operator);
    if (!definition?.composition) continue;
    const descendants = (id: string): string[] => groups.filter(child => child.parentId === id).flatMap(child => [...child.nodeIds, ...descendants(child.id)]);
    for (const id of [...group.nodeIds, ...descendants(group.id)]) members.set(id, instance.id);
    const ids = compositionNodeIds(instance, definition);
    for (const [port, endpoints] of Object.entries(definition.composition.inputs)) {
      for (const endpoint of endpoints) inputs.set(`${ids[endpoint.nodeId]}:${endpoint.portId}`, { node: instance.id, port });
    }
    for (const [port, endpoint] of Object.entries(definition.composition.outputs)) {
      outputs.set(`${ids[endpoint.nodeId]}:${endpoint.portId}`, { node: instance.id, port });
    }
    folded.push({ id: instance.id, operator: instance.operator, operatorVersion: instance.operatorVersion, bindings: {} });
    layout[instance.id] = group.composition!.position;
  }
  const edges: OperatorEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const fromInside = members.has(edge.from), toInside = members.has(edge.to);
    if (fromInside && toInside && members.get(edge.from) === members.get(edge.to)) continue;
    const from = fromInside ? outputs.get(`${edge.from}:${edge.output}`) : { node: edge.from, port: edge.output };
    const to = toInside ? inputs.get(`${edge.to}:${edge.input}`) : { node: edge.to, port: edge.input };
    if (!from || !to) continue;
    const key = `${from.node}:${from.port}>${to.node}:${to.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: edge.id, from: from.node, output: from.port, to: to.node, input: to.port });
  }
  return { ...graph, nodes: [...graph.nodes.filter(node => !members.has(node.id)), ...folded], edges, layout,
    groups: groups.filter(group => !insideCompound(group.id)) };
}

const port = (item: OperatorPort) => `${item.id}:${item.type}${item.required ? '!' : ''}${item.repeated ? '*' : ''}`;
function parameter(item: OperatorParameter, override?: { min?: number; max?: number; step?: number }): string {
  const min = override?.min ?? item.min, max = override?.max ?? item.max;
  const range = min !== undefined || max !== undefined ? ` [${min ?? ''}..${max ?? ''}]` : '';
  const options = item.options?.length ? ` {${item.options.map(option => option.value).join('|')}}` : '';
  return `${item.id}:${item.type}${range}${options}`;
}

export const AGENT_GRAPH_LEGEND = 'Ports are id:type (! required, * repeated). Params are id:type [min..max] {options}. Compound nodes are shown folded: connect and remove use the compound id with its public ports.';

export function agentGraphNode(node: BoundOperatorNode, position: { x: number; y: number } | undefined) {
  const spec = getEffectOperator(node.operator)!;
  const range = node.valueControl ?? node.exposed;
  return {
    id: node.id, operator: node.operator,
    ...(spec.composition ? { compound: true } : {}),
    ...(Object.keys(node.bindings).length ? { bindings: node.bindings } : {}),
    ...(node.constants && Object.keys(node.constants).length ? { constants: node.constants } : {}),
    ...(node.valueControl ? { valueControl: node.valueControl } : {}),
    ...(node.exposed ? { exposed: node.exposed } : {}),
    ...(node.bypassed ? { bypassed: true } : {}),
    ...(position ? { pos: [Math.round(position.x), Math.round(position.y)] } : {}),
    in: spec.inputs.map(port), out: spec.outputs.map(port),
    ...(spec.parameters.length ? { params: spec.parameters.map(item => parameter(item, item.id === 'value' ? range : undefined)) } : {}),
  };
}
