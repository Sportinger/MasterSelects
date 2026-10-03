import { startNodeMeasure, endNodeMeasure } from '../../../../services/nodeGraph/unified/nodeGraphPerformance';
import { undisplacedWorkspacePoint } from '../../../../services/nodeGraph/unified/expansionDisplacement';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { workspaceClipId, workspaceClipOwner, workspaceClipGroup } from '../../../../services/nodeGraph/unified/workspaceIds';
import { clipWorkspaceBatch } from './useClipDomainAdapter';
import { localWorkspacePoint } from '../../../../services/nodeGraph/unified/embedWorkspaceGraph';

export function workspaceCanvasPlacement(graph: NodeGraph): NodeCanvasPlacement {
  const measurement = import.meta.env.DEV ? startNodeMeasure('workspace-placement') : undefined;
  try {
  const groups: NodeCanvasPlacement['groups'] = {};
  for (const group of graph.groups ?? []) {
    const owner = workspaceClipOwner(group.id);
    const local = owner && graph.workspace?.clips[owner.clipId]?.placement.groups[owner.localId];
    groups[group.id] = { ...(local || {}), nodeIds: group.nodeIds, proxyId: group.proxyId, parentId: group.parentId,
      collapsed: group.collapsed, offset: local ? local.offset : { x: 0, y: 0 }, locked: local ? local.locked : true };
  }
  const nodes = Object.fromEntries(graph.nodes.map(node => [node.id, node.layout]));
  const pinned: Record<string, true> = {};
  for (const [clipId, entry] of Object.entries(graph.workspace?.clips ?? {})) {
    for (const [id, point] of Object.entries(entry.placement.nodes)) nodes[workspaceClipId(clipId, id)] ??= { x: point.x + entry.origin.x, y: point.y + entry.origin.y };
    for (const [id, value] of Object.entries(entry.placement.pinned ?? {})) pinned[workspaceClipId(clipId, id)] = value;
  }
  const branches: NonNullable<NodeCanvasPlacement['branches']> = {};
  for (const [clipId, entry] of Object.entries(graph.workspace?.clips ?? {})) for (const [id, branch] of Object.entries(entry.placement.branches ?? {})) {
    branches[workspaceClipId(clipId, id)] = { ...branch, nodeId: workspaceClipId(clipId, branch.nodeId),
      parentId: branch.parentId ? workspaceClipId(clipId, branch.parentId) : undefined,
      targets: branch.targets.map(target => ({ ...target, nodeId: workspaceClipId(clipId, target.nodeId) })),
      x: branch.x + entry.origin.x, y: branch.y + entry.origin.y };
  }
  const compactEffects = Object.values(graph.workspace?.clips ?? {}).every(entry => entry.placement.compactEffects !== false);
  return { nodes, groups, pinned, branches, compactEffects };
  } finally { if (import.meta.env.DEV) endNodeMeasure('workspace-placement', measurement); }
}

/** One history batch writes each affected owner's placement back in its own coordinates. */
export function saveWorkspacePlacement(graph: NodeGraph, before: NodeCanvasPlacement, next: NodeCanvasPlacement,
  label: string, domainCommit?: () => Record<string, string> | void, movingGroup?: string) {
  const state = useTimelineStore.getState();
  if (!graph.workspace || state.isExporting) return;
  const changed = Object.keys(next.nodes).filter(id => next.nodes[id].x !== before.nodes[id]?.x || next.nodes[id].y !== before.nodes[id]?.y);
  const owners = new Set(changed.flatMap(id => { const owner = workspaceClipOwner(id); return owner ? [owner.clipId] : []; }));
  for (const [id, group] of Object.entries(next.groups)) {
    const owner = workspaceClipOwner(id);
    if (owner && group !== before.groups[id]) owners.add(owner.clipId);
  }
  if (next.branches !== before.branches || next.compactEffects !== before.compactEffects) {
    for (const clipId of Object.keys(graph.workspace.clips)) owners.add(clipId);
  }
  const groupOwner = movingGroup && workspaceClipOwner(movingGroup);
  if (groupOwner) owners.add(groupOwner.clipId);
  if (graph.owner.kind === 'clip') owners.add(graph.owner.id);
  // Validate every participant before invoking a domain action or writing any layout.
  if ([...owners].some(id => { const clip = state.clips.find(clip => clip.id === id); return !clip || state.tracks.find(track => track.id === clip.trackId)?.locked; })) return;
  const compositionNodes: Record<string, NodeGraphLayout> = { ...state.compositionGraph?.layout?.nodes };
  const wholeClip = Object.entries(graph.workspace.clips).find(([id]) => movingGroup === workspaceClipGroup(id));
  if (wholeClip) {
    const [id] = wholeClip, nodeId = changed.find(nodeId => workspaceClipOwner(nodeId)?.clipId === id);
    if (nodeId) {
      const reference = `comp:clip:${id}`;
      const anchor = compositionNodes[reference] ?? graph.workspace.defaultNodes[reference];
      if (anchor) compositionNodes[reference] = { x: anchor.x + next.nodes[nodeId].x - before.nodes[nodeId].x, y: anchor.y + next.nodes[nodeId].y - before.nodes[nodeId].y };
    }
    owners.delete(id);
  }
  const arrangingComposition = graph.owner.kind === 'composition' && (label.startsWith('Arrange') || label.startsWith('Reset'));
  if (arrangingComposition) owners.clear();
  const compositionChanged = changed.some(id => !workspaceClipOwner(id)) || !!wholeClip || arrangingComposition;
  clipWorkspaceBatch(label, () => {
    const renamed = domainCommit?.();
    for (const clipId of owners) {
      const entry = graph.workspace!.clips[clipId]; if (!entry) continue;
      const clip = useTimelineStore.getState().clips.find(clip => clip.id === clipId); if (!clip) continue;
      const placement: NodeCanvasPlacement = { ...entry.placement, compactEffects: next.compactEffects, nodes: { ...entry.placement.nodes }, groups: { ...entry.placement.groups }, pinned: { ...entry.placement.pinned } };
      for (const [id, point] of Object.entries(next.nodes)) {
        const owner = workspaceClipOwner(renamed?.[id] ?? id);
        if (owner?.clipId !== clipId) continue;
        placement.nodes[owner.localId] = localWorkspacePoint(point, entry.origin);
        if (next.pinned?.[id]) placement.pinned![owner.localId] = true; else delete placement.pinned![owner.localId];
      }
      for (const [id, group] of Object.entries(next.groups)) {
        const owner = workspaceClipOwner(id); if (owner?.clipId !== clipId) continue;
        placement.groups[owner.localId] = { ...group, nodeIds: group.nodeIds.map(id => workspaceClipOwner(id)?.localId ?? id),
          proxyId: workspaceClipOwner(group.proxyId)?.localId ?? group.proxyId, parentId: group.parentId ? workspaceClipOwner(group.parentId)?.localId : undefined };
      }
      if (next.branches !== before.branches) placement.branches = Object.fromEntries(Object.entries(next.branches ?? {}).flatMap(([id, branch]) => {
        const owner = workspaceClipOwner(branch.nodeId);
        if (owner?.clipId !== clipId || branch.targets.some(target => workspaceClipOwner(target.nodeId)?.clipId !== clipId)) return [];
        return [[workspaceClipOwner(id)?.localId ?? id, { ...branch, nodeId: owner.localId,
          parentId: branch.parentId ? workspaceClipOwner(branch.parentId)?.localId : undefined,
          x: branch.x - entry.origin.x, y: branch.y - entry.origin.y,
          targets: branch.targets.map(target => ({ ...target, nodeId: workspaceClipOwner(target.nodeId)!.localId })) }]];
      }));
      useTimelineStore.getState().updateClip(clipId, { nodeGraph: { ...clip.nodeGraph, version: 1, nodes: clip.nodeGraph?.nodes ?? [],
        canvasPlacements: { ...clip.nodeGraph?.canvasPlacements, [entry.graph.id]: placement } } });
    }
    if (compositionChanged) {
      for (const id of changed) if (!workspaceClipOwner(id)) compositionNodes[id] = undisplacedWorkspacePoint(next.nodes[id], graph.workspace!.compositionOffsets?.[id]);
      state.updateCompositionGraph(current => ({ ...current, version: 1, layout: { ...current.layout,
        nodes: arrangingComposition ? graph.workspace!.defaultNodes : compositionNodes } }), { historyLabel: label });
    }
  });
}

/** Run the established layout algorithms in local graph space, never on namespaced ids. */
export function layoutWorkspaceClips(graph: NodeGraph, before: NodeCanvasPlacement,
  edit: (graph: NodeGraph, placement: NodeCanvasPlacement) => NodeCanvasPlacement): NodeCanvasPlacement {
  const next: NodeCanvasPlacement = { ...before, nodes: { ...before.nodes }, groups: { ...before.groups }, pinned: { ...before.pinned } };
  for (const [clipId, entry] of Object.entries(graph.workspace?.clips ?? {})) {
    const local = edit(entry.graph, entry.placement);
    next.compactEffects = local.compactEffects;
    for (const [id, position] of Object.entries(local.nodes)) {
      const key = workspaceClipId(clipId, id);
      next.nodes[key] = { x: position.x + entry.origin.x, y: position.y + entry.origin.y };
      if (local.pinned?.[id]) next.pinned![key] = true; else delete next.pinned![key];
    }
    for (const [id, group] of Object.entries(local.groups)) next.groups[workspaceClipId(clipId, id)] = { ...group,
      nodeIds: group.nodeIds.map(id => workspaceClipId(clipId, id)), proxyId: workspaceClipId(clipId, group.proxyId),
      parentId: group.parentId ? workspaceClipId(clipId, group.parentId) : before.groups[workspaceClipId(clipId, id)]?.parentId };
  }
  return next;
}
