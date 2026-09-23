import type { EffectOperatorGraph } from '../../types/operatorGraph';

/** A read-only projection. Boundary cables explain omitted neighbors without expanding them. */
export function selectOperatorGraphSlice(graph: EffectOperatorGraph, args: Record<string, unknown>) {
  const hops = args.hops ?? 0, direction = args.direction ?? 'both';
  if (!Number.isInteger(hops) || Number(hops) < 0 || Number(hops) > 4) throw new Error('hops must be 0..4.');
  if (!['upstream', 'downstream', 'both'].includes(String(direction))) throw new Error('Invalid neighbor direction.');
  const ids = args.nodeIds;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)) throw new Error('nodeIds must contain 1..100 distinct node IDs.');
  const selected = new Set<string>(ids as string[] | undefined ?? graph.nodes.map(n => n.id));
  const missing = [...selected].filter(id => !graph.nodes.some(n => n.id === id));
  if (missing.length) throw new Error(`Nodes not found: ${missing.join(', ')}`);
  for (let hop = 0; hop < Number(hops); hop++) {
    const previous = new Set(selected);
    for (const edge of graph.edges) {
      if (direction !== 'downstream' && previous.has(edge.to)) selected.add(edge.from);
      if (direction !== 'upstream' && previous.has(edge.from)) selected.add(edge.to);
    }
  }
  return { nodes: graph.nodes.filter(n => selected.has(n.id)),
    edges: graph.edges.filter(e => selected.has(e.from) && selected.has(e.to)),
    boundaryEdges: graph.edges.filter(e => selected.has(e.from) !== selected.has(e.to)),
    totalNodeCount: graph.nodes.length, omittedNodeCount: graph.nodes.length - selected.size };
}
