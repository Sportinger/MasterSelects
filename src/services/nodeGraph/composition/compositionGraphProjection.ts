import { startNodeMeasure, endNodeMeasure } from '../unified/nodeGraphPerformance';
// Pure projection: timeline state -> level-0 composition graph (packet B).
import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { CompositionGraphState } from '../../../types/compositionGraph';
import type { TransitionCompositionLink } from '../../../types/timelineCore';
import { compositionEdge, compositionNode, compositionPort, finite } from './compositionGraphPrimitives';
import { compositionGraphLayout } from './compositionGraphLayout';
import { compositionMediaId, projectCompositionMedia } from './compositionGraphMedia';
import { projectCompositionTimeChain } from './compositionGraphTimeChain';
import { projectCompositionRules } from './compositionGraphRules';
import { projectCompositionRelations } from './compositionGraphRelations';
import { compositionClipPairs } from './compositionGraphClipPairs';
import { projectTrackStripSegments } from './compositionTrackStrips';
import { deriveCompositionTransitionParents, type CompositionTransitionParent } from './compositionTransitionParents';

export { compositionGroupId } from './compositionGraphPrimitives';
export { compositionMediaId } from './compositionGraphMedia';
export { indexCompositionClipNodes } from './compositionGraphClipPairs';

export interface CompositionGraphMediaInfo {
  /** Stable media identity (media file id, or `comp:<compositionId>` for nested compositions). */
  id: string;
  name: string;
  /** Source duration in seconds when known. */
  duration?: number;
  kind: 'video' | 'audio' | 'image' | 'composition' | 'other';
}

export interface CompositionGraphProjectionInput {
  compositionId: string;
  compositionName: string;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  /** Lookup for media nodes; missing entries fall back to clip names. */
  media: ReadonlyMap<string, CompositionGraphMediaInfo>;
  state?: CompositionGraphState;
  /** Clip ids whose time chain group is expanded (presentation only). */
  expandedTimeChains?: ReadonlySet<string>;
  /** Presentation extents of the lazily built clip subgraphs. */
  expandedClipSizes?: ReadonlyMap<string, { width: number; height: number }>;
  /** Actual composition length; defaults to the latest clip end when omitted. */
  duration?: number;
  /** Existing transition link, for navigation back to parent participants. */
  transitionLink?: TransitionCompositionLink;
  /** Parent clip identities for additional panel slices in a transition composition. */
  transitionSourceParents?: ReadonlyMap<string, string | CompositionTransitionParent>;
}

/** Projected node id helpers, shared with the UI for selection and navigation. */
export const compositionNodeId = {
  output: () => 'comp:output',
  videoStack: () => 'comp:video-stack',
  audioMaster: () => 'comp:audio-master',
  track: (trackId: string) => `comp:track:${trackId}`,
  clip: (clipId: string) => `comp:clip:${clipId}`,
  media: (mediaId: string) => `comp:media:${mediaId}`,
  transition: (transitionId: string) => `comp:transition:${transitionId}`,
  timeChain: (clipId: string, stage: 'slice' | 'speed' | 'place') => `comp:clip:${clipId}:${stage}`,
  beatSource: (ruleId: string) => `comp:rule:${ruleId}:beats`,
  rule: (ruleId: string) => `comp:rule:${ruleId}`,
} as const;

/** Deterministic, side-effect free. Never creates project state. */
export function buildCompositionGraph(input: CompositionGraphProjectionInput): NodeGraph {
  const measurement = import.meta.env.DEV ? startNodeMeasure('composition-projection') : undefined;
  try {
  const graph: NodeGraph = {
    id: `composition:${input.compositionId}`,
    owner: { kind: 'composition', id: input.compositionId, name: input.compositionName },
    nodes: [],
    edges: [],
    groups: [],
  };
  const pairs = compositionClipPairs(input.clips, input.tracks);
  const transitionParents = input.transitionSourceParents ?? deriveCompositionTransitionParents(input.clips, input.transitionLink);
  const layout = compositionGraphLayout(input, pairs.videoByAudio);
  const media = projectCompositionMedia(input, graph, pairs.videoByAudio);
  const clips = new Map<string, NodeGraphNode>();
  const tracks = new Map(input.tracks.map(track => [track.id, track]));
  const normalized = (time: number) => layout.duration > 0 ? Math.max(0, Math.min(1, time / layout.duration)) : 0;
  for (const clip of input.clips) {
    if (pairs.videoByAudio.has(clip.id)) continue;
    const audio = pairs.audioByVideo.get(clip.id);
    const nestedCompositionId = clip.isComposition ? clip.compositionId : undefined;
    const node = compositionNode(input.state, compositionNodeId.clip(clip.id), clip.name,
      { kind: 'composition-clip', clipId: clip.id, ...(audio ? { linkedClipId: audio.id } : {}),
        ...(nestedCompositionId ? { nestedCompositionId } : {}) },
      layout.clips.get(clip.id)!,
      [compositionPort('source', 'Source', 'clip', 'input'),
        compositionPort('place', 'Place', 'time', 'input', { readOnly: !!clip.transitionSourceMap })],
      [compositionPort('clip', audio ? 'Bild' : 'Clip', 'clip', 'output', { readOnly: false, targetClipId: clip.id }),
        ...(audio ? [compositionPort('audio', 'Ton', 'clip', 'output', { readOnly: false, targetClipId: audio.id })] : [])]);
    const speed = clip.transitionSourceMap?.version === 2 ? clip.transitionSourceMap.parent.defaultSpeed : clip.speed ?? 1;
    const duration = input.media.get(compositionMediaId(clip))?.duration ?? clip.source?.naturalDuration;
    const badges: string[] = clip.timeRemap?.kind === 'freeze' ? ['Freeze'] : clip.timeRemap?.kind === 'loop' ? ['Loop']
      : clip.timeRemap?.kind === 'warp' ? ['Warp'] : [];
    if (audio) badges.push('Linked audio');
    if (speed !== 1) badges.push(`Speed ${speed}×`);
    if (clip.reversed || speed < 0) badges.push('Reverse');
    if (clip.inPoint > 0 || (duration !== undefined && clip.outPoint < duration)) badges.push('Trim');
    if (!tracks.has(clip.trackId)) badges.push('Missing track');
    if (clip.transitionSourceMap) badges.push('Mapped', 'Read-only');
    node.summary = { badges, bar: { start: normalized(finite(clip.startTime)),
      end: normalized(finite(clip.startTime) + Math.max(0, finite(clip.duration))) } };
    const link = input.transitionLink;
    const parent = transitionParents.get(clip.id);
    const parentClipId = (typeof parent === 'string' ? parent : parent?.parentClipId)
      ?? (link?.linkedOutgoingClipId === clip.id ? link.parentOutgoingClipId
        : link?.linkedIncomingClipId === clip.id ? link.parentIncomingClipId : undefined);
    const role = typeof parent === 'object' ? parent.role
      : parentClipId && link ? parentClipId === link.parentOutgoingClipId ? 'outgoing'
        : parentClipId === link.parentIncomingClipId ? 'incoming' : undefined : undefined;
    const panel = typeof parent === 'object' ? parent.panel : undefined;
    if (role) badges.push(role === 'outgoing' ? 'Outgoing' : 'Incoming');
    if (panel) badges.push(`Panel ${panel}`);
    node.params = { startTime: clip.startTime, duration: clip.duration, inPoint: clip.inPoint,
      outPoint: clip.outPoint, speed, reversed: !!clip.reversed || speed < 0, trackId: clip.trackId,
      sourceName: input.media.get(compositionMediaId(clip))?.name ?? clip.name,
      effectCount: clip.effects?.length ?? 0, maskCount: clip.masks?.length ?? 0,
      ...(clip.timeRemap?.kind ? { retime: clip.timeRemap.kind } : {}),
      ...(audio ? { audioTrackId: audio.trackId } : {}),
      ...(parentClipId && link ? { parentClipId, parentCompositionId: link.parentCompositionId } : {}),
      ...(role ? { transitionRole: role } : {}), ...(panel ? { transitionPanel: panel } : {}) };
    node.description = parentClipId ? `Transition source of parent clip ${parentClipId}.`
      : nestedCompositionId ? 'Nested composition reference; open to inspect its level-0 graph.'
        : 'Timeline clip reference; open to inspect its processing graph.';
    clips.set(clip.id, node);
    if (audio) clips.set(audio.id, node);
    graph.nodes.push(node);
    const target = projectCompositionTimeChain(input, graph, clip, node);
    const source = media.get(clip.id)!;
    graph.edges.push(compositionEdge(source.nodeId, source.portId, target.nodeId, target.portId, 'clip'));
    if (tracks.has(clip.trackId)) graph.edges.push(compositionEdge(node.id, 'clip', compositionNodeId.track(clip.trackId), 'clips', 'clip', false));
    if (audio) {
      if (tracks.has(audio.trackId)) graph.edges.push(compositionEdge(node.id, 'audio', compositionNodeId.track(audio.trackId), 'clips', 'clip', false));
      if (compositionMediaId(audio) !== compositionMediaId(clip)) {
        node.inputs.push(compositionPort('audio-source', 'Audio source', 'clip', 'input', { targetClipId: audio.id }));
        const audioSource = media.get(audio.id)!;
        graph.edges.push(compositionEdge(audioSource.nodeId, audioSource.portId, node.id, 'audio-source', 'clip'));
      }
    }
  }
  const stack = compositionNode(input.state, compositionNodeId.videoStack(), 'Video-Stack',
    { kind: 'composition-video-stack' }, { x: layout.busX, y: 80 }, [],
    [compositionPort('image', 'Bild', 'texture', 'output')]);
  const master = compositionNode(input.state, compositionNodeId.audioMaster(), 'Audio-Master',
    { kind: 'composition-audio-master' }, { x: layout.busX, y: 80 }, [],
    [compositionPort('audio', 'Ton', 'audio', 'output')]);
  // Preserve track array order: LayerBuilder uses the same order for layerIndex.
  for (const track of input.tracks) {
    const video = track.type === 'video';
    const type = video ? 'texture' : 'audio';
    const bus = video ? stack : master;
    const node = compositionNode(input.state, compositionNodeId.track(track.id), track.name,
      { kind: 'composition-track', trackId: track.id }, { x: layout.trackX, y: layout.tracks.get(track.id)! },
      [compositionPort('clips', 'Clips', 'clip', 'input', { readOnly: false, repeated: true })],
      [compositionPort('output', video ? 'Bild' : 'Ton', type, 'output')]);
    node.summary = { badges: [...(track.locked ? ['Lock'] : []), ...(track.muted ? ['Mute'] : []),
      ...(track.solo ? ['Solo'] : []), ...(track.visible === false ? ['Hidden'] : [])] };
    node.description = video ? 'Track membership; when clips overlap, the later-starting clip wins.'
      : 'Track membership and existing audio mix; no additional bus routing is implied.';
    node.params = { trackType: track.type, locked: !!track.locked, muted: track.muted, solo: track.solo, visible: track.visible };
    graph.nodes.push(node);
    const portId = `track:${track.id}`;
    bus.inputs.push(compositionPort(portId, track.name, type, 'input'));
    graph.edges.push(compositionEdge(node.id, 'output', bus.id, portId, type));
  }
  master.defaultLayout = { x: layout.busX, y: 280 + stack.inputs.length * 28 };
  if (!input.state?.layout?.nodes[master.id]) master.layout.y = master.defaultLayout.y;
  const output = compositionNode(input.state, compositionNodeId.output(), 'Composition Output',
    { kind: 'composition-output' }, { x: layout.busX + 240, y: 160 },
    [compositionPort('image', 'Bild', 'texture', 'input'), compositionPort('audio', 'Ton', 'audio', 'input')]);
  output.description = input.compositionName;
  graph.nodes.push(stack, master, output);
  graph.edges.push(compositionEdge(stack.id, 'image', output.id, 'image', 'texture'),
    compositionEdge(master.id, 'audio', output.id, 'audio', 'audio'));
  projectCompositionRelations(input, graph, clips);
  projectCompositionRules(input, graph, clips, layout.height);
  projectTrackStripSegments(input, graph, layout);
  if (graph.expandedNodes) graph.expandedNodes = [...graph.expandedNodes, ...graph.nodes];
  return graph;
  } finally { if (import.meta.env.DEV) endNodeMeasure('composition-projection', measurement); }
}
