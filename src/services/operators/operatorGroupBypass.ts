import type { EffectOperatorGraph, OperatorGroup } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';

type BypassRoutes = Map<string, { from: string; output: string }> | undefined;
interface GraphIndex {
  nodes: Map<string, EffectOperatorGraph['nodes'][number]>;
  sources: Map<string, string[]>;
  routes: Map<OperatorGroup, BypassRoutes>;
  bypassed?: EffectOperatorGraph;
}
// Graphs are immutable snapshots. Previews, projection and every render compile
// the same large graph repeatedly, so lookups and results are shared per object.
const indexes = new WeakMap<EffectOperatorGraph, GraphIndex>();
function graphIndex(graph: EffectOperatorGraph): GraphIndex {
  let index = indexes.get(graph);
  if (!index) {
    const sources = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = sources.get(edge.to);
      if (list) list.push(edge.from); else sources.set(edge.to, [edge.from]);
    }
    index = { nodes: new Map(graph.nodes.map(node => [node.id, node])), sources, routes: new Map() };
    indexes.set(graph, index);
  }
  return index;
}

export function operatorGroupMembers(graph: EffectOperatorGraph, groupId: string): Set<string> {
  const members = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    graph.groups?.find(group => group.id === id)?.nodeIds.forEach(node => members.add(node));
    graph.groups?.filter(group => group.parentId === id).forEach(group => visit(group.id));
  };
  visit(groupId);
  return members;
}

/** Only offer pass-through when every output has one unique, type-compatible external source. */
export function operatorGroupBypassRoutes(graph: EffectOperatorGraph, group: OperatorGroup): BypassRoutes {
  if (graph.domain !== 'image') return undefined;
  const index = graphIndex(graph);
  if (index.routes.has(group)) return index.routes.get(group);
  const routes = computeBypassRoutes(graph, group, index);
  index.routes.set(group, routes);
  return routes;
}

function computeBypassRoutes(graph: EffectOperatorGraph, group: OperatorGroup, index: GraphIndex): BypassRoutes {
  const members = operatorGroupMembers(graph, group.id);
  const incoming = graph.edges.filter(edge => !members.has(edge.from) && members.has(edge.to));
  const outgoing = graph.edges.filter(edge => members.has(edge.from) && !members.has(edge.to));
  if (!incoming.length || !outgoing.length) return undefined;
  const signal = (id: string, port: string) => {
    const node = index.nodes.get(id);
    return node && getEffectOperator(node.operator)?.outputs.find(output => output.id === port)?.type;
  };
  const routes = new Map<string, { from: string; output: string }>();
  for (const edge of outgoing) {
    const type = signal(edge.from, edge.output);
    if (!type) return undefined;
    const declared = group.bypassOutputs?.[`${edge.from}:${edge.output}`];
    if (group.bypassOutputs && (!declared || members.has(declared.nodeId) || signal(declared.nodeId, declared.portId) !== type)) return undefined;
    const candidates = declared ? new Map([['declared', { from: declared.nodeId, output: declared.portId }]]) : new Map(incoming.filter(input => signal(input.from, input.output) === type)
      .map(input => [`${input.from}:${input.output}`, { from: input.from, output: input.output }]));
    if (candidates.size !== 1) return undefined;
    const candidate = [...candidates.values()][0];
    const visited = new Set<string>();
    const dependsOnGroup = (id: string): boolean => {
      if (members.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return (index.sources.get(id) ?? []).some(dependsOnGroup);
    };
    if (dependsOnGroup(candidate.from)) return undefined;
    routes.set(edge.id, candidate);
  }
  return routes;
}

/** Scene branches already have a renderer-owned mute contract. */
export function operatorGroupRenderer(graph: EffectOperatorGraph, groupId: string) {
  if (graph.domain !== 'scene') return undefined;
  const members = operatorGroupMembers(graph, groupId);
  const renderers = graph.nodes.filter(node => members.has(node.id) && ['splat.render', 'scene.mesh'].includes(node.operator));
  return renderers.length === 1 ? renderers[0] : undefined;
}

/** Compile a temporary view. Saved wiring and all nested bypass states remain untouched. */
export function applyOperatorGroupBypasses(graph: EffectOperatorGraph): EffectOperatorGraph {
  const bypassed = graph.groups?.filter(group => group.bypassed) ?? [];
  if (!bypassed.length) return graph;
  const index = graphIndex(graph);
  return index.bypassed ??= bypassGraph(graph, bypassed);
}

function bypassGraph(graph: EffectOperatorGraph, bypassed: OperatorGroup[]): EffectOperatorGraph {
  const depth = (group: OperatorGroup): number => {
    const visited = new Set([group.id]);
    while (group.parentId) {
      const parent = graph.groups!.find(parent => parent.id === group.parentId);
      if (!parent || visited.has(parent.id)) throw new Error('Invalid group bypass hierarchy.');
      visited.add(parent.id); group = parent;
    }
    return visited.size - 1;
  };
  const replacements = new Map<string, { from: string; output: string }>();
  for (const group of bypassed.toSorted((a, b) => depth(b) - depth(a))) {
    const routes = operatorGroupBypassRoutes(graph, group);
    if (!routes) throw new Error(`Group ${group.label} no longer has an unambiguous bypass boundary.`);
    for (const edge of graph.edges) {
      const replacement = routes.get(edge.id);
      if (replacement) replacements.set(`${edge.from}:${edge.output}`, replacement);
    }
  }
  return { ...graph, edges: graph.edges.map(edge => {
    let endpoint = { from: edge.from, output: edge.output };
    const visited = new Set<string>();
    for (;;) {
      const id = `${endpoint.from}:${endpoint.output}`, replacement = replacements.get(id);
      if (!replacement) return { ...edge, ...endpoint };
      if (visited.has(id)) throw new Error('Group bypass boundaries form a cycle.');
      visited.add(id); endpoint = replacement;
    }
  }) };
}
