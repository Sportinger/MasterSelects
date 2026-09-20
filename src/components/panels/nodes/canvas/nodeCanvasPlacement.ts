import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout } from '../../../../types/nodeGraph';
import { spacePreviewGroups } from './spacePreviewGroups';

export function groupPlacementMembers(placement: NodeCanvasPlacement, id: string): Set<string> {
  const members = new Set<string>();
  const visited = new Set<string>();
  const collect = (groupId: string) => {
    if (visited.has(groupId)) return;
    visited.add(groupId);
    const group = placement.groups[groupId];
    if (!group) return;
    members.add(group.proxyId);
    group.nodeIds.forEach(nodeId => members.add(nodeId));
    for (const [childId, child] of Object.entries(placement.groups)) if (child.parentId === groupId) collect(childId);
  };
  collect(id);
  return members;
}

/** Existing positions are fixed obstacles. Only newly appearing nodes are packed. */
export function reconcileCanvasPlacement(graph: NodeGraph, previous?: NodeCanvasPlacement): NodeCanvasPlacement {
  const placement: NodeCanvasPlacement = { nodes: { ...previous?.nodes }, groups: { ...previous?.groups } };
  for (const group of graph.groups ?? []) {
    const before = placement.groups[group.id];
    placement.groups[group.id] = { ...before, nodeIds: group.collapsed ? [...new Set([...(before?.nodeIds ?? []), ...group.nodeIds])] : [...group.nodeIds],
      proxyId: group.proxyId, parentId: group.parentId, offset: before?.offset ?? { x: 0, y: 0 } };
  }
  const nodes = graph.nodes.map(node => {
    if (placement.nodes[node.id]) return { ...node, layout: placement.nodes[node.id] };
    const collapsed = graph.groups?.find(group => group.collapsed && group.proxyId === node.id);
    const remembered = collapsed && [...groupPlacementMembers(placement, collapsed.id)]
      .flatMap(id => placement.nodes[id] ? [placement.nodes[id]] : []);
    if (remembered && remembered.length) return { ...node, layout: {
      x: Math.min(...remembered.map(point => point.x)), y: Math.min(...remembered.map(point => point.y)),
    } };
    const offset = { x: 0, y: 0 };
    for (const group of Object.values(placement.groups)) {
      if (group.nodeIds.includes(node.id) || group.proxyId === node.id) {
        offset.x += group.offset.x; offset.y += group.offset.y;
      }
    }
    return { ...node, layout: { x: node.layout.x + offset.x, y: node.layout.y + offset.y } };
  });
  const fixed = new Set(Object.keys(placement.nodes));
  // Folding an existing group is a presentation change, not a new node.
  for (const group of graph.groups ?? []) if (group.collapsed
    && [...groupPlacementMembers(placement, group.id)].some(id => fixed.has(id))) fixed.add(group.proxyId);
  for (const node of spacePreviewGroups({ ...graph, nodes }, fixed)) placement.nodes[node.id] = node.layout;
  return placement;
}

export function moveCanvasPlacement(placement: NodeCanvasPlacement, moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string): NodeCanvasPlacement {
  const next = { nodes: { ...placement.nodes }, groups: { ...placement.groups } };
  if (groupId && moves.length) {
    const first = moves[0], before = placement.nodes[first.nodeId];
    const group = placement.groups[groupId];
    if (before && group) {
      const delta = { x: first.layout.x - before.x, y: first.layout.y - before.y };
      for (const id of groupPlacementMembers(placement, groupId)) {
        const point = placement.nodes[id];
        if (point) next.nodes[id] = { x: point.x + delta.x, y: point.y + delta.y };
      }
      next.groups[groupId] = { ...group, offset: { x: group.offset.x + delta.x, y: group.offset.y + delta.y } };
    }
  }
  for (const move of moves) next.nodes[move.nodeId] = move.layout;
  return next;
}
