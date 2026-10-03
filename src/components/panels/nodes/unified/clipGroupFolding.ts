import type { NodeGraph } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { buildClipNodeGraphDocument, createClipNodeGraphState } from '../../../../services/nodeGraph';
import { buildUnifiedClipGraph } from '../../../../services/nodeGraph/unifiedClipGraph';
import { resolveLinkedClipNodeGraphContext } from '../../../../services/nodeGraph/clipGraphLinking';
import { startBatch, endBatch } from '../../../../stores/historyStore';

/** Existing fold-all operation, shared by clip roots and explicitly opening collapsed clips. */
export function setWorkspaceClipGroupsCollapsed(clipIds: readonly string[], collapsed: boolean, visibleGraphs: ReadonlyMap<string, NodeGraph> = new Map()) {
  const state = readTimelineRuntimeState(useTimelineStore);
  const clips = [...new Set(clipIds)].map(id => state.clips.find(clip => clip.id === id));
  if (state.isExporting || clips.some(clip => !clip || state.tracks.find(track => track.id === clip.trackId)?.locked)) throw new Error('A clip is locked or exporting.');
  // Inventory hidden descendants before starting the mutation. Ordinary viewing never calls this.
  const updates = clips.map(clip => {
    const current = clip!, context = resolveLinkedClipNodeGraphContext(state.clips, state.tracks, current.id);
    const document = buildClipNodeGraphDocument(current, context?.ownerTrack ?? undefined, {
      linkedClip: context?.linkedClip, linkedTrack: context?.linkedTrack,
    });
    const expanded = buildUnifiedClipGraph(document, current, state.clips, [], undefined, true);
    const ids = new Set([...(expanded.groups ?? []), ...(visibleGraphs.get(current.id)?.groups ?? [])].map(group => group.id));
    const model = current.nodeGraph ?? createClipNodeGraphState(current), groups = { ...model.groups };
    for (const id of ids) groups[id] = { ...groups[id], collapsed };
    return { id: current.id, nodeGraph: { ...model, groups } };
  });
  const batch = startBatch(collapsed ? 'Collapse all node groups' : 'Expand all node groups');
  try { for (const update of updates) state.updateClip(update.id, { nodeGraph: update.nodeGraph }); }
  finally { if (batch.opened) endBatch(); }
}
