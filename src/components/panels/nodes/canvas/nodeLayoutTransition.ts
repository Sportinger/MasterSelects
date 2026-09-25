import type { NodeGraph, NodeGraphNode, NodeGraphLayout } from '../../../../types/nodeGraph';

export interface NodeLayoutSnapshot { graph: NodeGraph; nodes: NodeGraphNode[] }
export const NODE_LAYOUT_DURATION = 220;

/** Fold transitions retain the outgoing interior until it reaches its proxy.
 * The same interpolated positions drive cards, cables, hit targets and frames. */
export function createNodeLayoutTransition(before: NodeLayoutSnapshot, target: NodeLayoutSnapshot) {
  const previous = new Map(before.nodes.map(node => [node.id, node]));
  const next = new Map(target.nodes.map(node => [node.id, node]));
  const anchor = (nodeId: string, expanded: NodeLayoutSnapshot, compact: NodeLayoutSnapshot): NodeGraphLayout | undefined => {
    for (const group of compact.graph.groups ?? []) {
      if (!group.collapsed || !expanded.graph.groups?.find(item => item.id === group.id)?.nodeIds.includes(nodeId)) continue;
      const proxy = compact.nodes.find(node => node.id === group.proxyId);
      if (proxy) return proxy.layout;
    }
  };
  const closing = target.graph.groups?.some(group => group.collapsed
    && before.graph.groups?.some(old => old.id === group.id && !old.collapsed));
  const base = closing ? before : target;
  const paths = base.nodes.map(node => ({
    node: next.get(node.id) ?? node,
    from: previous.get(node.id)?.layout ?? anchor(node.id, target, before) ?? node.layout,
    to: next.get(node.id)?.layout ?? anchor(node.id, before, target) ?? node.layout,
  }));
  const changed = paths.some(({ from, to }) => from.x !== to.x || from.y !== to.y);
  const duration = NODE_LAYOUT_DURATION;
  // Nodes that do not move in this fold step keep their identity, so a staggered
  // fold only re-derives the group that is actually animating.
  const settled = paths.map(({ node, from, to }) => from.x === to.x && from.y === to.y
    ? (node.layout.x === to.x && node.layout.y === to.y ? node : { ...node, layout: to }) : undefined);
  return { changed, duration,
    /** Final positions of this move, with outgoing interiors parked on their proxy. */
    end(): NodeLayoutSnapshot {
      return { graph: base.graph, nodes: paths.map(({ node, to }, index) => settled[index] ?? { ...node, layout: to }) };
    },
    sample(progress: number): NodeLayoutSnapshot {
    if (progress >= 1) return target;
    const t = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
    return { graph: base.graph, nodes: paths.map(({ node, from, to }, index) => settled[index]
      ?? { ...node, layout: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t } }) };
  } };
}
