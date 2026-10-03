import { startNodeMeasure, endNodeMeasure } from '../../../../services/nodeGraph/unified/nodeGraphPerformance';
import type { NodeGraph, NodeGraphPort } from '../../../../types/nodeGraph';
import type { TimelineClip, TimelineTrack } from '../../../../types/timeline';

/** Track assignment keeps its clip-reference type, with a compatible track format. */
export function withCompositionTrackPorts(graph: NodeGraph, clips: readonly TimelineClip[], tracks: readonly TimelineTrack[]): NodeGraph {
  const measurement = import.meta.env.DEV ? startNodeMeasure('track-ports') : undefined;
  try {
  const trackTypes = new Map(tracks.map(track => [track.id, track.type]));
  const clipTypes = new Map(clips.map(clip => [clip.id, trackTypes.get(clip.trackId) ?? (clip.source?.type === 'audio' ? 'audio' : 'video')]));
  const format = (port: NodeGraphPort, type: string): NodeGraphPort => port.type !== 'clip' || port.metadata?.readOnly ? port : {
    ...port, metadata: { ...port.metadata, contract: { typeLabel: 'Clip', description: 'Compatible timeline track assignment.',
      ...port.metadata?.contract, formats: [`timeline-track:${type}`] } },
  };
  return { ...graph, nodes: graph.nodes.map(node => {
    const binding = node.binding;
    if (binding?.kind === 'composition-clip') return { ...node, outputs: node.outputs.map(port => format(port, clipTypes.get(port.metadata?.targetClipId ?? binding.clipId) ?? 'video')) };
    if (binding?.kind === 'composition-track') return { ...node, inputs: node.inputs.map(port => format(port, trackTypes.get(binding.trackId) ?? 'video')) };
    return node;
  }) };
  } finally { if (import.meta.env.DEV) endNodeMeasure('track-ports', measurement); }
}
