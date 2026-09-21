import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition } from '../../types/operatorGraph';
import { COORDINATE_COMPOSITIONS, coordinateCompositionRevision } from './coordinateCompositions';
import { COLOR_COMPOSITIONS } from './colorCompositions';
import { compositionBoundary, packOperatorCompositions, sameCompositionNode } from './operatorComposition';
import { IMAGE_EFFECT_GRAPH_LIMITS } from './effectGraphLimits';
import { getOperatorComposition } from './operatorCompositionRegistry';

const cache = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
/** Exact, bounded structural recognition, independent of effect names and node IDs. */
export function recognizeOperatorCompositions(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.domain !== 'image' || source.incomplete || source.compositionRules === 2 && source.colorCompositionRules === 1) return source;
  const cached = cache.get(source); if (cached) return cached;
  let graph = source;
  let recognizedColor = false;
  const rules = [
    ...COORDINATE_COMPOSITIONS.map(definition => ({ definition, revision: coordinateCompositionRevision(definition.id), applied: source.compositionRules ?? 0 })),
    ...COLOR_COMPOSITIONS.map(definition => ({ definition, revision: 1 as const, applied: source.colorCompositionRules ?? 0 })),
  ];
  for (const { definition, revision, applied } of rules) {
    if (revision <= applied) continue;
    let remaining = 4096;
    while (remaining > 0) {
      const body = definition.composition!.graph;
      const protectedIds = new Set(graph.groups?.filter(group => revision === 1 || group.composition).flatMap(group => group.nodeIds));
      const owner = new Map(graph.groups?.flatMap(group => group.nodeIds.map(id => [id, group.id] as const)));
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
          // A new shared node may live inside a user's group, but cannot cross its boundary.
          if (revision > 1 && [...used].some(id => owner.get(id) !== owner.get(candidate.id))) continue;
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
      if (COLOR_COMPOSITIONS.includes(definition)) recognizedColor = true;
    }
  }
  graph = { ...graph, compositionRules: 2,
    ...(source.colorCompositionRules === 1 || recognizedColor ? { colorCompositionRules: 1 as const } : {}) };
  cache.set(source, graph); cache.set(graph, graph);
  return graph;
}

function extract(source: EffectOperatorGraph, definition: OperatorDefinition, mapping: Record<string, string>): EffectOperatorGraph | undefined {
  const groupCost = (nodes: BoundOperatorNode[], depth = 0): number => nodes.reduce((total, node) => {
    const body = getOperatorComposition(node.operator)?.composition;
    return total + (body ? depth >= 4 ? Infinity : 1 + groupCost(body.graph.nodes, depth + 1) : 0);
  }, 0);
  if ((source.groups?.length ?? 0) + groupCost(source.nodes) >= 32) return;
  const graph = structuredClone(source), ids = { ...mapping }, members = new Set(Object.values(ids));
  const parent = graph.groups?.find(group => group.nodeIds.includes(Object.values(ids)[0]));
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
  if (parent) parent.nodeIds = parent.nodeIds.filter(id => !Object.values(ids).includes(id));
  (graph.groups ??= []).push({ id: `compound-${instanceId}`, label: definition.label, color: '#799ab4', nodeIds: Object.values(ids),
    ...(parent ? { parentId: parent.id } : {}),
    collapsedByDefault: true, composition: { instance: { id: instanceId, operator: definition.id, operatorVersion: 1, bindings: {},
      composition: { nodeIds: ids, layout: {} } }, position } });
  return packOperatorCompositions(graph);
}
