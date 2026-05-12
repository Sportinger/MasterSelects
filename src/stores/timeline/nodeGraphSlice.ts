import type { NodeGraphLayout, TimelineClip } from '../../types';
import { createClipNodeGraphState, updateClipNodeGraphLayout } from '../../services/nodeGraph';
import type { NodeGraphActions, SliceCreator } from './types';

export const createNodeGraphSlice: SliceCreator<NodeGraphActions> = (set, get) => ({
  ensureClipNodeGraph: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip || clip.nodeGraph) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = createClipNodeGraphState(clip, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
  },

  moveClipNodeGraphNode: (clipId, nodeId, layout: NodeGraphLayout) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = updateClipNodeGraphLayout(clip, nodeId, layout, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
  },
});
