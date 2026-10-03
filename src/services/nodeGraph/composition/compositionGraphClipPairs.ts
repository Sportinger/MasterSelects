import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { compositionNodeId } from './compositionGraphProjection';

/** Index both projected clip ids to the one visible reference, including folded audio. */
export function indexCompositionClipNodes(graph: NodeGraph): ReadonlyMap<string, NodeGraphNode> {
  const index = new Map<string, NodeGraphNode>();
  for (const node of graph.nodes) {
    if (node.binding?.kind !== 'composition-clip') continue;
    index.set(compositionNodeId.clip(node.binding.clipId), node);
    if (node.binding.linkedClipId) index.set(compositionNodeId.clip(node.binding.linkedClipId), node);
  }
  return index;
}

/** The output port retains the timeline participant's identity after folding. */
export function compositionClipOutputPort(node: NodeGraphNode, clipId: string): 'clip' | 'audio' {
  return node.binding?.kind === 'composition-clip' && node.binding.linkedClipId === clipId ? 'audio' : 'clip';
}

export function compositionClipPairs(clips: readonly TimelineClip[], tracks: readonly TimelineTrack[]) {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const trackTypes = new Map(tracks.map(track => [track.id, track.type]));
  const audioByVideo = new Map<string, TimelineClip>();
  const videoByAudio = new Map<string, TimelineClip>();
  const isAudio = (clip: TimelineClip) => clip.source?.type === 'audio' || trackTypes.get(clip.trackId) === 'audio';
  const isVisual = (clip: TimelineClip) => !isAudio(clip)
    && (!trackTypes.has(clip.trackId) || trackTypes.get(clip.trackId) === 'video');
  const pair = (video: TimelineClip, audio: TimelineClip) => {
    if (audioByVideo.has(video.id) || videoByAudio.has(audio.id)) return;
    // Do not consume a participant that explicitly belongs to a different pair.
    if ((video.linkedClipId && video.linkedClipId !== audio.id)
      || (audio.linkedClipId && audio.linkedClipId !== video.id)) return;
    audioByVideo.set(video.id, audio);
    videoByAudio.set(audio.id, video);
  };
  for (const clip of clips) {
    const partner = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    if (partner && isVisual(clip) && isAudio(partner)) pair(clip, partner);
  }
  // Legacy one-way links may exist only on the audio clip.
  for (const clip of clips) {
    const partner = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    if (partner && isAudio(clip) && isVisual(partner)) pair(partner, clip);
  }
  return { audioByVideo, videoByAudio };
}
