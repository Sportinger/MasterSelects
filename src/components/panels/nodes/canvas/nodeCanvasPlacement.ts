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

/** Preserve saved anchors while reflowing dynamic groups and effect-chain changes. */
export function reconcileCanvasPlacement(graph: NodeGraph, previous?: NodeCanvasPlacement): NodeCanvasPlacement {
  const placement: NodeCanvasPlacement = { ...previous, nodes: { ...previous?.nodes }, groups: { ...previous?.groups }, pinned: { ...previous?.pinned }, displaced: { ...previous?.displaced } };
  const visible = new Set(graph.nodes.map(node => node.id));
  const currentGroups = new Set(graph.groups?.map(group => group.id));
  // A missing outer group was deleted; hidden descendants of a collapsed group
  // still need their saved placement. Remove only the deleted group's subtree.
  const removedGroups = new Set(Object.keys(placement.groups).filter(id => !placement.groups[id].parentId && !currentGroups.has(id)));
  const reflowFromSource = removedGroups.size > 0;
  for (const id of removedGroups) {
    for (const [childId, child] of Object.entries(placement.groups)) if (child.parentId === id) removedGroups.add(childId);
    const group = placement.groups[id];
    for (const member of [group.proxyId, ...group.nodeIds]) if (!visible.has(member)) {
      delete placement.nodes[member]; delete placement.pinned![member]; delete placement.displaced![member];
    }
    delete placement.groups[id];
  }
  const addedEffects = new Set<string>();
  if (previous) {
    for (const group of graph.groups ?? []) if (group.effectId && !previous.groups[group.id]) addedEffects.add(group.proxyId);
    for (const node of graph.nodes) if (node.binding?.kind === 'clip-effect' && !previous.nodes[node.id]
      && !Object.values(previous.groups).some(group => group.proxyId === node.id)) addedEffects.add(node.id);
  }
  const expanding = new Set<string>();
  let folded = false;
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
    if (before && before.collapsed !== !!group.collapsed) folded = true;
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
  const flow = graph.groups?.some(group => group.layoutMode === 'flow');
  const growingFlow = previous && graph.nodes.some(node => dynamic.has(node.id) && !previous.nodes[node.id]);
  const outer = { reflow: reflowFromSource || addedEffects.size > 0 || (!!flow && (folded || growingFlow || previous?.flowLayoutVersion !== 1)), reflowFromSource, compactEffects: placement.compactEffects, addedEffects, groupMoves: new Map<string, NodeGraphLayout>() };
  for (const node of spacePreviewGroups({ ...graph, nodes }, fixed, expanding, displaced, outer)) placement.nodes[node.id] = node.layout;
  // Keep hidden interiors and future regenerated layouts in the translated frame.
  // Otherwise the next parameter edit would restore the old wide outer spacing.
  for (const [id, delta] of outer.groupMoves) {
    const group = placement.groups[id];
    placement.groups[id] = { ...group, offset: { x: group.offset.x + delta.x, y: group.offset.y + delta.y } };
    for (const member of groupPlacementMembers(placement, id)) if (!visible.has(member) && placement.nodes[member]) {
      const point = placement.nodes[member]; placement.nodes[member] = { x: point.x + delta.x, y: point.y + delta.y };
    }
  }
  if (flow) placement.flowLayoutVersion = 1;
  for (const [id, origin] of displaced) {
    const before = placement.displaced![id];
    placement.displaced![id] = { origin: before?.origin ?? origin, groups: [...new Set([...(before?.groups ?? []), ...expanding])] };
  }
  return placement;
}

export function moveCanvasPlacement(placement: NodeCanvasPlacement, moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string): NodeCanvasPlacement {
  const next = { ...placement, nodes: { ...placement.nodes }, groups: { ...placement.groups }, pinned: { ...placement.pinned }, displaced: { ...placement.displaced } };
  // A manual move keeps the grouped arrangement the user sees. Unpinned flow
  // members would otherwise re-flow around the moved card and shift whole groups.
  // Ungrouped downstream stages still follow a resized effect, new nodes are
  // still placed automatically, and Arrange releases the pins.
  if (moves.length) for (const group of Object.values(next.groups)) for (const id of [group.proxyId, ...group.nodeIds]) {
    if (next.nodes[id]) next.pinned[id] = true;
  }
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

/** Explicit Arrange releases manual anchors inside dynamically arranged groups. */
export function arrangeFlowPlacement(graph: NodeGraph, placement: NodeCanvasPlacement): NodeCanvasPlacement {
  const next: NodeCanvasPlacement = { ...placement, flowLayoutVersion: undefined, nodes: { ...placement.nodes }, groups: { ...placement.groups },
    pinned: { ...placement.pinned }, displaced: { ...placement.displaced } };
  const members = new Set<string>();
  for (const group of graph.groups ?? []) if (group.layoutMode === 'flow') groupPlacementMembers(placement, group.id).forEach(id => members.add(id));
  for (const id of members) { delete next.nodes[id]; delete next.pinned![id]; delete next.displaced![id]; }
  for (const [id, group] of Object.entries(next.groups)) if (members.has(group.proxyId)) next.groups[id] = { ...group, offset: { x: 0, y: 0 } };
  return reconcileCanvasPlacement(graph, next);
}

/** Reset manual anchors and arrange every visible group with the existing flow layout. */
export function resetCanvasPlacement(graph: NodeGraph, compactEffects = true): NodeCanvasPlacement {
  const arranged = { ...graph,
    nodes: graph.nodes.map(node => node.binding?.kind === 'clip-source' ? { ...node, layout: { x: 0, y: 0 } } : node),
    groups: graph.groups?.map(group => ({ ...group, layoutMode: 'flow' as const })),
  };
  const nodes = spacePreviewGroups(arranged, new Set(), new Set(), undefined, {
    reflow: true, compactEffects, addedEffects: new Set(graph.nodes.map(node => node.id)), groupMoves: new Map(),
  });
  return reconcileCanvasPlacement({ ...graph, nodes }, { nodes: {}, groups: {}, compactEffects });
}

/** Change only outer placement; preserve manual interior positions and wiring. */
export function toggleCompactEffectPlacement(graph: NodeGraph, placement: NodeCanvasPlacement): NodeCanvasPlacement {
  return reconcileCanvasPlacement(graph, { ...placement, compactEffects: placement.compactEffects === false, flowLayoutVersion: undefined });
}
