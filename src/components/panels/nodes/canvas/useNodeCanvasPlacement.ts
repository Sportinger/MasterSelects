import { useCallback, useMemo, useRef, useState } from 'react';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphLayout } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { arrangeFlowPlacement, moveCanvasPlacement, reconcileCanvasPlacement, resetCanvasPlacement } from './nodeCanvasPlacement';

export function useNodeCanvasPlacement(graph: NodeGraph, layoutScaleX: number) {
  const saved = useTimelineStore(state => state.clips.find(clip => clip.id === graph.owner.id)?.nodeGraph?.canvasPlacements?.[graph.id]);
  const cache = useRef<{ graphId: string; saved?: NodeCanvasPlacement; placement: NodeCanvasPlacement } | null>(null);
  const [revision, setRevision] = useState(0);
  const placement = useMemo(() => {
    const before = cache.current;
    const previous = before?.graphId === graph.id && before.saved === saved ? before.placement : saved;
    const scaled = { ...graph, nodes: graph.nodes.map(node => ({ ...node, layout: { x: node.layout.x * layoutScaleX, y: node.layout.y } })) };
    const next = reconcileCanvasPlacement(scaled, previous);
    cache.current = { graphId: graph.id, saved, placement: next };
    return next;
  }, [graph, saved, layoutScaleX, revision]);
  const nodes = useMemo(() => graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] })), [graph.nodes, placement]);
  const save = useCallback((next: NodeCanvasPlacement, label: string, domainCommit?: () => Record<string, string> | void) => {
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
  }, [graph.id, graph.owner.id, saved]);
  const commit = useCallback((moves: Array<{ nodeId: string; layout: NodeGraphLayout }>, groupId?: string, domainCommit?: () => Record<string, string> | void) =>
    save(moveCanvasPlacement(placement, moves, groupId), groupId ? 'Move node group' : 'Move nodes', domainCommit), [placement, save]);
  const toggleLock = useCallback((id: string) => {
    const group = placement.groups[id];
    if (group) save({ ...placement, groups: { ...placement.groups, [id]: { ...group, locked: group.locked === false } } }, 'Toggle group lock');
  }, [placement, save]);
  const arrange = useCallback(() => save(arrangeFlowPlacement(graph, placement), 'Arrange effect nodes'), [graph, placement, save]);
  const reset = useCallback(() => save(resetCanvasPlacement(graph), 'Reset node layout'), [graph, save]);
  return { nodes, placement, commit, toggleLock, arrange, reset };
}
