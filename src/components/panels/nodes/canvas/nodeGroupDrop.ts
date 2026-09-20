import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import { nodeGroupBounds } from './groupBounds';

export function containingNodeGroups(graph: NodeGraph, nodeId: string) {
  return (graph.groups ?? []).filter(group => group.nodeIds.includes(nodeId));
}

export function hasUnlockedSource(graph: NodeGraph, placement: NodeCanvasPlacement, nodeIds: string[]): boolean {
  return nodeIds.some(id => containingNodeGroups(graph, id).some(group => placement.groups[group.id]?.locked === false));
}

/** Hit-test the stationary frames, never the frame stretched by a dragged node. */
export function nodeGroupDropTarget(graph: NodeGraph, nodes: NodeGraphNode[], placement: NodeCanvasPlacement,
  nodeIds: string[], point: NodeGraphLayout): string | undefined {
  const bounds = nodeGroupBounds(graph, nodes);
  const candidates = (graph.groups ?? []).filter(group => {
    const box = bounds.get(group.id);
    return !group.collapsed && box && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  }).toSorted((a, b) => {
    const first = bounds.get(a.id)!, second = bounds.get(b.id)!;
    return (first.right - first.left) * (first.bottom - first.top) - (second.right - second.left) * (second.bottom - second.top);
  });
  const target = candidates[0];
  if (!target) return;
  const ancestors = new Set<string>();
  let current: typeof target | undefined = target;
  while (current) { ancestors.add(current.id); current = graph.groups?.find(group => group.id === current?.parentId); }
  const changed = nodeIds.some(id => {
    const containing = containingNodeGroups(graph, id);
    return containing.length !== ancestors.size || containing.some(group => !ancestors.has(group.id));
  });
  if (!changed) return;
  for (const id of nodeIds) {
    const source = containingNodeGroups(graph, id);
    if (!source.some(group => placement.groups[group.id]?.locked === false))
      throw new Error(`Unlock ${source.at(-1)?.label ?? 'the source group'} before moving nodes across its boundary.`);
  }
  return target.id;
}
