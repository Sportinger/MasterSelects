import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineTransition } from '../../../types/timelineCore';
import { DATAMOSH_BAKE_FORMAT } from '../../../transitions/datamosh';
import { compositionNodeId, type CompositionGraphProjectionInput } from './compositionGraphProjection';
import { compositionEdge, compositionNode, compositionPort, seconds } from './compositionGraphPrimitives';
import { compositionClipOutputPort } from './compositionGraphClipPairs';

export function projectCompositionRelations(
  input: CompositionGraphProjectionInput, graph: NodeGraph, nodes: ReadonlyMap<string, NodeGraphNode>,
): void {
  const clips = new Map(input.clips.map(clip => [clip.id, clip]));
  const tracks = new Set(input.tracks.map(track => track.id));
  const transitions = new Map<string, { transition: TimelineTransition; outgoing: string; incoming: string }>();
  // Prefer the outgoing record when mirrored transition data is inconsistent.
  for (const clip of input.clips) if (clip.transitionOut) transitions.set(clip.transitionOut.id,
    { transition: clip.transitionOut, outgoing: clip.id, incoming: clip.transitionOut.linkedClipId });
  for (const clip of input.clips) if (clip.transitionIn && !transitions.has(clip.transitionIn.id)) {
    transitions.set(clip.transitionIn.id,
      { transition: clip.transitionIn, outgoing: clip.transitionIn.linkedClipId, incoming: clip.id });
  }
  for (const { transition, outgoing, incoming } of transitions.values()) {
    const a = nodes.get(outgoing), b = nodes.get(incoming);
    const anchor = a ?? b;
    const binding = anchor?.binding;
    const expanded = binding?.kind === 'composition-clip' && (input.expandedTimeChains?.has(binding.clipId)
      || (binding.linkedClipId && input.expandedTimeChains?.has(binding.linkedClipId)));
    const node = compositionNode(input.state, compositionNodeId.transition(transition.id), transition.type,
      { kind: 'composition-transition', transitionId: transition.id, outgoingClipId: outgoing,
        incomingClipId: incoming, ...(transition.compositionId ? { compositionId: transition.compositionId } : {}) },
      { x: anchor?.layout.x ?? 420, y: (anchor?.layout.y ?? 80)
        + (expanded ? 520 : 250) },
      [compositionPort('a', 'A', 'clip', 'input'), compositionPort('b', 'B', 'clip', 'input')],
      [compositionPort('clip', 'Transition', 'clip', 'output')]);
    node.summary = { badges: [transition.type, `Duration ${seconds(transition.duration)}`,
      `Offset ${seconds(transition.offset ?? 0)}`, transition.compositionId ? 'Composition' : 'Recipe',
      ...(!a || !b ? ['Missing clip'] : [])] };
    if (transition.type === 'datamosh' && transition.params?.bakedMediaFileId) {
      const params = transition.params;
      const current = params.bakedFormat === DATAMOSH_BAKE_FORMAT
        && typeof params.bakedDuration === 'number'
        && Math.abs(params.bakedDuration - Math.max(0.0001, transition.duration)) <= 1 / 240
        && typeof params.bitrateMbps === 'number' && typeof params.bakedBitrateMbps === 'number'
        && Math.abs(params.bitrateMbps - params.bakedBitrateMbps) <= 0.000_001;
      node.summary.badges = [...node.summary.badges!, current ? 'Bake' : 'Bake stale'];
    }
    node.params = { duration: transition.duration, offset: transition.offset ?? 0 };
    node.description = 'Existing transition relationship. Opening its body is a separate explicit action.';
    graph.nodes.push(node);
    if (a) graph.edges.push(compositionEdge(a.id, compositionClipOutputPort(a, outgoing), node.id, 'a', 'clip'));
    if (b) graph.edges.push(compositionEdge(b.id, compositionClipOutputPort(b, incoming), node.id, 'b', 'clip'));
    const trackId = clips.get(outgoing)?.trackId ?? clips.get(incoming)?.trackId;
    if (trackId && tracks.has(trackId)) graph.edges.push(compositionEdge(node.id, 'clip', compositionNodeId.track(trackId), 'clips', 'clip'));
  }
}
