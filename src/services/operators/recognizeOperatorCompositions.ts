import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition } from '../../types/operatorGraph';
import { COORDINATE_COMPOSITIONS } from './coordinateCompositions';
import { compositionBoundary, packOperatorCompositions, sameCompositionNode } from './operatorComposition';
import { IMAGE_EFFECT_GRAPH_LIMITS } from './effectGraphLimits';

const cache = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
/** Exact, bounded structural recognition, independent of effect names and node IDs. */
export function recognizeOperatorCompositions(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.domain !== 'image' || source.incomplete || source.compositionRules === 1) return source;
  const cached = cache.get(source); if (cached) return cached;
  let graph = source;
  for (const definition of COORDINATE_COMPOSITIONS) {
    let remaining = 4096;
    while (remaining > 0) {
      const body = definition.composition!.graph, protectedIds = new Set(graph.groups?.flatMap(group => group.nodeIds));
      const candidates = new Map(body.nodes.map(node => [node.id,
        graph.nodes.filter(actual => !protectedIds.has(actual.id) && sameCompositionNode(actual, node))]));
      if ([...candidates.values()].some(items => !items.length)) break;
      const ids: Record<string, string> = {}, used = new Set<string>();
      const connected = (node: BoundOperatorNode) => body.edges.filter(edge =>
        edge.to === node.id && ids[edge.from] || edge.from === node.id && ids[edge.to]).length;
      const search = (): EffectOperatorGraph | undefined => {
        if (--remaining < 0) return;
        const next = body.nodes.filter(node => !ids[node.id]).toSorted((a, b) =>
          connected(b) - connected(a) || candidates.get(a.id)!.length - candidates.get(b.id)!.length)[0];
        if (!next) return extract(graph, definition, ids);
        for (const candidate of candidates.get(next.id)!) {
          if (used.has(candidate.id)) continue;
          ids[next.id] = candidate.id;
          const matches = body.edges.every(edge => !ids[edge.from] || !ids[edge.to] || graph.edges.some(actual =>
            actual.from === ids[edge.from] && actual.output === edge.output && actual.to === ids[edge.to] && actual.input === edge.input));
          if (matches) { used.add(candidate.id); const result = search(); if (result) return result; used.delete(candidate.id); }
          delete ids[next.id];
          if (remaining <= 0) break;
        }
      };
      const next = search(); if (!next) break;
      graph = next;
    }
  }
  graph = { ...graph, compositionRules: 1 };
  cache.set(source, graph); cache.set(graph, graph);
  return graph;
}

function extract(source: EffectOperatorGraph, definition: OperatorDefinition, mapping: Record<string, string>): EffectOperatorGraph | undefined {
  if ((source.groups?.length ?? 0) + source.nodes.filter(node => COORDINATE_COMPOSITIONS.some(def => def.id === node.operator)).length >= 32) return;
  const graph = structuredClone(source), ids = { ...mapping }, members = new Set(Object.values(ids));
  const unique = (base: string) => { let id = base, count = 2; while (graph.nodes.some(node => node.id === id)
    || graph.groups?.some(group => group.id === `compound-${id}`)) id = `${base}-${count++}`; return id; };
  const first = definition.composition!.graph.nodes[0].id, instanceId = unique(`shared-${ids[first]}`);
  // A shared literal is safe to duplicate. Bound/animated values and computational fan-out are never copied.
  for (const template of definition.composition!.graph.nodes.filter(node => node.operator === 'values.number')) {
    const oldId = ids[template.id];
    if (!graph.edges.some(edge => edge.from === oldId && !members.has(edge.to))) continue;
    const id = unique(`${instanceId}--${template.id}`);
    graph.nodes.push({ ...structuredClone(template), id }); graph.layout[id] = graph.layout[oldId] ?? { x: 0, y: 0 };
    for (const edge of graph.edges) if (edge.from === oldId && members.has(edge.to)) edge.from = id;
    ids[template.id] = id;
  }
  const boundary = compositionBoundary(graph, definition, ids);
  if (graph.nodes.length > IMAGE_EFFECT_GRAPH_LIMITS.nodes) return;
  if (!boundary || Object.values(boundary.inputs).some(endpoints => !boundary.incoming.some(edge =>
    edge.to === endpoints[0].nodeId && edge.input === endpoints[0].portId))) return;
  const position = graph.layout[ids[first]] ?? { x: 0, y: 0 };
  (graph.groups ??= []).push({ id: `compound-${instanceId}`, label: definition.label, color: '#799ab4', nodeIds: Object.values(ids),
    collapsedByDefault: true, composition: { instance: { id: instanceId, operator: definition.id, operatorVersion: 1, bindings: {},
      composition: { nodeIds: ids, layout: {} } }, position } });
  return packOperatorCompositions(graph);
}
