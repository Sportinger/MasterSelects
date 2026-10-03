import { startNodeMeasure, endNodeMeasure } from '../../../../services/nodeGraph/unified/nodeGraphPerformance';
import { workspaceCanvasPlacement, saveWorkspacePlacement, layoutWorkspaceClips } from '../unified/workspaceCanvasPlacement';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { arrangeFlowPlacement, moveCanvasPlacement, reconcileCanvasPlacement, resetCanvasPlacement, toggleCompactEffectPlacement } from './nodeCanvasPlacement';
import { compositionCanvasPlacement } from '../composition/compositionCanvasPlacement';

export function useNodeCanvasPlacement(graph: NodeGraph, layoutScaleX: number) {
  const saved = useTimelineStore(state => graph.owner.kind === 'clip' ? state.clips.find(clip => clip.id === graph.owner.id)?.nodeGraph?.canvasPlacements?.[graph.id] : undefined);
  const compositionLayout = useTimelineStore(state => graph.owner.kind === 'composition' ? state.compositionGraph?.layout : undefined);
  const cache = useRef<{ graphId: string; saved?: NodeCanvasPlacement; placement: NodeCanvasPlacement } | null>(null);
  const [revision, setRevision] = useState(0);
  const placement = useMemo(() => {
    const measurement = import.meta.env.DEV ? startNodeMeasure('placement') : undefined;
    try {
    if (graph.workspace) return workspaceCanvasPlacement(graph);
    if (graph.owner.kind === 'composition') return compositionCanvasPlacement(graph, compositionLayout);
    const before = cache.current;
    const previous = before?.graphId === graph.id && before.saved === saved ? before.placement : saved;
    const scaled = { ...graph, nodes: graph.nodes.map(node => ({ ...node, layout: { x: node.layout.x * layoutScaleX, y: node.layout.y } })) };
    const next = reconcileCanvasPlacement(scaled, previous);
    cache.current = { graphId: graph.id, saved, placement: next };
    return next;
    } finally { if (import.meta.env.DEV) endNodeMeasure('placement', measurement); }
  }, [graph, saved, compositionLayout, layoutScaleX, revision]);
  const nodes = useMemo(() => graph.nodes.map(node => {
    const layout = placement.nodes[node.id] ?? node.layout;
    return layout.x === node.layout.x && layout.y === node.layout.y ? node : { ...node, layout };
  }), [graph.nodes, placement]);
  const save = useCallback((next: NodeCanvasPlacement, label: string, domainCommit?: () => Record<string, string> | void, movingGroup?: string) => {
    if (graph.workspace) { saveWorkspacePlacement(graph, placement, next, label, domainCommit, movingGroup); return; }
    if (graph.owner.kind === 'composition') {
      useTimelineStore.getState().updateCompositionGraph(current => ({ ...current, version: 1,
        layout: { ...current?.layout, nodes: next.nodes } }), { historyLabel: label, skipHistory: false });
      return;
    }
    const state = readTimelineRuntimeState(useTimelineStore);
    const clip = state.clips.find(candidate => candidate.id === graph.owner.id);
    if (clip && (state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked)) return;
    const batch = startBatch(label);
    try {
      const renamed = domainCommit?.();
      if (renamed) for (const [id, replacement] of Object.entries(renamed)) if (id !== replacement && next.nodes[id]) {
        next.nodes[replacement] = next.nodes[id]; delete next.nodes[id];
      }
      const current = readTimelineRuntimeState(useTimelineStore).clips.find(candidate => candidate.id === graph.owner.id);
      if (current) state.updateClip(current.id, { nodeGraph: { ...current.nodeGraph, version: 1, nodes: current.nodeGraph?.nodes ?? [],
        canvasPlacements: { ...current.nodeGraph?.canvasPlacements, [graph.id]: next } } });
      else {
        cache.current = { graphId: graph.id, saved, placement: next };
        setRevision(value => value + 1);
      }
    } finally { if (batch.opened) endBatch(); }
  }, [graph, placement, saved]);
  const commit = useCallback((moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string, domainCommit?: () => Record<string, string> | void) =>
    save(moveCanvasPlacement(placement, moves, groupId), groupId ? 'Move node group' : 'Move nodes', domainCommit, groupId), [placement, save]);
  const setBranches = useCallback((branches: NonNullable<NodeCanvasPlacement['branches']>, label: string) => save({ ...placement, branches }, label), [placement, save]);
  const toggleLock = useCallback((id: string) => {
    const group = placement.groups[id];
    if (group) save({ ...placement, groups: { ...placement.groups, [id]: { ...group, locked: group.locked === false } } }, 'Toggle group lock');
  }, [placement, save]);
  const arrange = useCallback(() => save(graph.workspace ? graph.owner.kind === 'composition' ? placement : layoutWorkspaceClips(graph, placement, arrangeFlowPlacement) : arrangeFlowPlacement(graph, placement), 'Arrange effect nodes'), [graph, placement, save]);
  const reset = useCallback(() => { const next = graph.workspace ? graph.owner.kind === 'composition' ? { ...placement, nodes: { ...placement.nodes, ...graph.workspace.defaultNodes } } : layoutWorkspaceClips(graph, placement, (local, value) => resetCanvasPlacement(local, value.compactEffects !== false)) : resetCanvasPlacement(graph, placement.compactEffects !== false); save(next, 'Reset node layout'); return next; }, [graph, placement.compactEffects, save]);
  const toggleCompact = useCallback(() => save(graph.workspace ? layoutWorkspaceClips(graph, placement, toggleCompactEffectPlacement) : toggleCompactEffectPlacement(graph, placement), 'Toggle compact effects'), [graph, placement, save]);
  return { nodes, placement, commit, setBranches, toggleLock, arrange, reset, toggleCompact };
}
