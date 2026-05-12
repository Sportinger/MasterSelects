import type { NodeGraphLayout, TimelineClip } from '../../types';
import {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
  createClipNodeGraphState,
  updateClipCustomNodeDefinition,
  updateClipNodeGraphLayout,
} from '../../services/nodeGraph';
import type { NodeGraphActions, SliceCreator } from './types';

function generateCustomNodeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

  addClipAICustomNode: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return null;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeId = generateCustomNodeId();
    const definition = createClipAICustomNodeDefinition(nodeId, clip);
    const nodeGraph = addClipCustomNodeDefinition(clip, definition, track);
    set({
      clips: clips.map((candidate: TimelineClip) => (
        candidate.id === clipId
          ? { ...candidate, nodeGraph }
          : candidate
      )),
    });
    return nodeId;
  },

  updateClipAICustomNode: (clipId, nodeId, updates) => {
    const { clips, tracks } = get();
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;

    const track = tracks.find((candidate) => candidate.id === clip.trackId);
    const nodeGraph = updateClipCustomNodeDefinition(clip, nodeId, updates, track);
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
