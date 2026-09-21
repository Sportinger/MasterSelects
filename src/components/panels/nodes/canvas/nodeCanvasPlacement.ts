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
  const placement: NodeCanvasPlacement = { nodes: { ...previous?.nodes }, groups: { ...previous?.groups }, pinned: { ...previous?.pinned }, displaced: { ...previous?.displaced } };
  const expanding = new Set<string>();
  for (const [id, displacement] of Object.entries(placement.displaced!)) {
    const active = displacement.groups.filter(id => graph.groups?.some(group => group.id === id && !group.collapsed));
    if (active.length === displacement.groups.length) continue;
    placement.nodes[id] = displacement.origin;
    delete placement.displaced![id];
    // Returning nodes must still avoid other expanded frames that displaced them.
    active.forEach(id => expanding.add(id));
  }
  for (const group of graph.groups ?? []) {
    const before = placement.groups[group.id];
    if (!group.collapsed && before?.collapsed) expanding.add(group.id);
    placement.groups[group.id] = { ...before, nodeIds: group.collapsed ? [...new Set([...(before?.nodeIds ?? []), ...group.nodeIds])] : [...group.nodeIds],
      proxyId: group.proxyId, parentId: group.parentId, collapsed: !!group.collapsed, offset: before?.offset ?? { x: 0, y: 0 } };
  }
  const dynamic = new Set<string>();
  for (const group of graph.groups ?? []) if (group.layoutMode === 'flow') {
    for (const id of groupPlacementMembers(placement, group.id)) dynamic.add(id);
  }
  // The clip output and following processing stages move with the resized effect.
  const queue = [...dynamic];
  for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) if (edge.fromNodeId === queue[i] && !dynamic.has(edge.toNodeId)) {
    dynamic.add(edge.toNodeId); queue.push(edge.toNodeId);
  }
  for (const id of dynamic) if (!placement.pinned?.[id]) delete placement.nodes[id];
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
  const displaced = new Map<string, NodeGraphLayout>();
  for (const node of spacePreviewGroups({ ...graph, nodes }, fixed, expanding, displaced)) placement.nodes[node.id] = node.layout;
  for (const [id, origin] of displaced) {
    const before = placement.displaced![id];
    placement.displaced![id] = { origin: before?.origin ?? origin, groups: [...new Set([...(before?.groups ?? []), ...expanding])] };
  }
  return placement;
}

export function moveCanvasPlacement(placement: NodeCanvasPlacement, moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string): NodeCanvasPlacement {
  const next = { nodes: { ...placement.nodes }, groups: { ...placement.groups }, pinned: { ...placement.pinned }, displaced: { ...placement.displaced } };
  if (groupId && moves.length) {
    const first = moves[0], before = placement.nodes[first.nodeId];
    const group = placement.groups[groupId];
    if (before && group) {
      const delta = { x: first.layout.x - before.x, y: first.layout.y - before.y };
      for (const id of groupPlacementMembers(placement, groupId)) {
        delete next.displaced[id];
        const point = placement.nodes[id];
        if (point) next.nodes[id] = { x: point.x + delta.x, y: point.y + delta.y };
      }
      next.groups[groupId] = { ...group, offset: { x: group.offset.x + delta.x, y: group.offset.y + delta.y } };
    }
  }
  for (const move of moves) { next.nodes[move.nodeId] = move.layout; next.pinned[move.nodeId] = true; delete next.displaced[move.nodeId]; }
  return next;
}
