import { useTimelineStore } from '../../../../stores/timeline';
import { startBatch, endBatch, cancelHistoryBatch } from '../../../../stores/historyStore';
import type { NodeGraphLayout } from '../../../../types/nodeGraph';

/** The add and its placement share one owner. Nested adds must never finish a
 * caller's transaction; failed additions roll back the transaction we opened. */
export function runWorkspaceAdd<T>(clipId: string, label: string, action: () => T): T {
  const state = useTimelineStore.getState();
  const clip = state.clips.find(clip => clip.id === clipId);
  if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) {
    throw new Error('The clip is unavailable, locked or exporting.');
  }
  const batch = startBatch(label);
  try {
    const value = action();
    if (batch.opened) endBatch();
    return value;
  } catch (error) {
    if (batch.opened) cancelHistoryBatch();
    throw error;
  }
}

/** Shared by clip-root and inline controllers; always read the current store. */
export function clipWorkspaceAddActions(clipId: string) {
  const place = (nodeId: string, layout?: NodeGraphLayout) => {
    if (layout) useTimelineStore.getState().moveClipNodeGraphNode(clipId, nodeId, layout);
    return nodeId;
  };
  return {
    builtIn: (node: 'transform' | 'mask' | 'color', layout?: NodeGraphLayout) => runWorkspaceAdd(clipId, 'Add built-in node', () => {
      useTimelineStore.getState().showClipNodeGraphBuiltIn(clipId, node);
      return place(node, layout);
    }),
    effect: (type: string, layout?: NodeGraphLayout) => runWorkspaceAdd(clipId, 'Add effect node', () => {
      const id = useTimelineStore.getState().addClipEffect(clipId, type);
      return place(`effect-${id}`, layout);
    }),
    ai: (layout?: NodeGraphLayout) => runWorkspaceAdd(clipId, 'Add AI node', () => {
      const id = useTimelineStore.getState().addClipAICustomNode(clipId);
      return id ? place(id, layout) : null;
    }),
    color: (type: 'primary' | 'wheels') => runWorkspaceAdd(clipId, `Add ${type} color node`, () =>
      useTimelineStore.getState().addColorNode(clipId, type)),
  };
}
