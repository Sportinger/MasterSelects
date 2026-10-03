import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip } from '../../../types/timeline';
import { compositionNodeId, type CompositionGraphProjectionInput } from './compositionGraphProjection';
import { compositionGroupId, compositionNode, compositionPort, finite, seconds } from './compositionGraphPrimitives';

/** Runtime URLs and File object identity are intentionally not media identities. */
export function compositionMediaId(clip: TimelineClip): string {
  if (clip.isComposition && clip.compositionId) return `comp:${clip.compositionId}`;
  return clip.mediaFileId || clip.source?.mediaFileId
    || (clip.signalAssetId ? `signal:${clip.signalAssetId}` : undefined)
    || (clip.source?.liveInputId ? `live:${clip.source.liveInputId}` : undefined)
    || `clip-source:${clip.id}`;
}

/** Source intervals are independent of timeline duration, playback direction and speed. */
function mediaSegments(clips: readonly TimelineClip[], duration: number) {
  const normalized = (time: number) => duration > 0 ? Math.max(0, Math.min(1, finite(time) / duration)) : 0;
  const lanes: number[] = [];
  return clips.map(clip => ({ id: `piece:${clip.id}`, clipId: clip.id,
    start: normalized(clip.inPoint), end: normalized(clip.outPoint),
    label: `${clip.name} (${Number(finite(clip.inPoint).toFixed(3))}-${Number(finite(clip.outPoint).toFixed(3))} s)`,
  })).toSorted((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id)).map(segment => {
    const available = lanes.findIndex(end => end <= segment.start);
    const lane = available < 0 ? lanes.length : available;
    lanes[lane] = Math.max(segment.start, segment.end);
    return { ...segment, lane };
  });
}

export function projectCompositionMedia(
  input: CompositionGraphProjectionInput, graph: NodeGraph, videoByAudio?: ReadonlyMap<string, TimelineClip>,
) {
  const sources = new Map<string, { node: NodeGraphNode; pieces: TimelineClip[] }>();
  const endpoints = new Map<string, { nodeId: string; portId: string }>();
  const groupId = compositionGroupId.media();
  const collapsed = input.state?.layout?.collapsed?.[groupId] ?? true;
  for (const clip of input.clips) {
    const mediaId = compositionMediaId(clip);
    const video = videoByAudio?.get(clip.id);
    let source = sources.get(mediaId);
    if (!source) {
      const info = input.media.get(mediaId);
      const node = compositionNode(input.state, compositionNodeId.media(mediaId), info?.name ?? clip.name,
        { kind: 'composition-media', mediaId }, { x: 40, y: 80 });
      node.groupId = groupId;
      node.description = 'Shared source; pieces retain independent trim and placement.';
      source = { node, pieces: [] };
      sources.set(mediaId, source);
    }
    // A linked pair shares one selectable source piece and the normal linked selection.
    if (video && compositionMediaId(video) === mediaId) continue;
    source.pieces.push(clip);
    const portId = `piece:${clip.id}`;
    source.node.outputs.push(compositionPort(portId, clip.name, 'clip', 'output', { targetClipId: clip.id,
      contract: { typeLabel: 'Source piece', description: `${seconds(clip.inPoint)}–${seconds(clip.outPoint)} of the shared source.`,
        formats: ['clip'], constraints: ['source range in seconds'] } }));
    endpoints.set(clip.id, { nodeId: source.node.id, portId });
  }
  if (!sources.size) return endpoints;
  let y = 80;
  const mediaNodes: NodeGraphNode[] = [];
  for (const [mediaId, { node, pieces }] of sources) {
    const count = pieces.length;
    const declaredDuration = input.media.get(mediaId)?.duration;
    const naturalDuration = pieces.reduce((max, clip) => Math.max(max, finite(clip.source?.naturalDuration)), 0);
    const duration = declaredDuration !== undefined && Number.isFinite(declaredDuration) && declaredDuration > 0
      ? declaredDuration : naturalDuration;
    const extent = duration > 0 ? duration : pieces.reduce((max, clip) => Math.max(max, finite(clip.outPoint)), 0);
    // Do not advertise the inferred used-source extent as a known full media duration.
    node.params = { mediaId, pieces: count, ...(duration > 0 ? { duration } : {}) };
    node.defaultLayout = { x: 40, y };
    if (!input.state?.layout?.nodes[node.id]) node.layout.y = y;
    // Leave room for source lanes/compact tiles and the existing per-piece output sockets.
    y += 280 + count * 40;
    node.summary = { badges: [`${count} pieces`, ...(duration > 0 ? [seconds(duration)] : ['Unknown length'])],
      ...(!collapsed ? { segments: mediaSegments(pieces, extent) } : {}) };
    mediaNodes.push(node);
  }
  const proxyId = `${groupId}:proxy`;
  graph.groups!.push({ id: groupId, label: `Media (${sources.size})`, color: '#55a6c4',
    collapsed, collapsedByDefault: true, proxyId, nodeIds: collapsed ? [proxyId] : mediaNodes.map(node => node.id) });
  const aliasSharedAudio = () => {
    for (const [audioId, video] of videoByAudio ?? []) {
      if (!endpoints.has(audioId)) endpoints.set(audioId, endpoints.get(video.id)!);
    }
  };
  if (!collapsed) {
    graph.nodes.push(...mediaNodes);
    aliasSharedAudio();
    return endpoints;
  }
  const proxy = compositionNode(input.state, proxyId, `Media (${sources.size})`,
    { kind: 'operator-group', groupId }, { x: 40, y: 80 });
  proxy.groupId = groupId;
  proxy.runtime = 'subgraph';
  // One shared socket per media source bundles its piece cables without losing leaf endpoints.
  for (const [mediaId, { node }] of sources) {
    const portId = `media:${mediaId}`;
    const groupEndpoints = node.outputs.map(port => ({ nodeId: node.id, portId: port.id }));
    proxy.outputs.push(compositionPort(portId, node.label, 'clip', 'output', {
      groupEndpoint: groupEndpoints[0], groupEndpoints,
    }));
    for (const port of node.outputs) endpoints.set(port.metadata!.targetClipId!, { nodeId: proxyId, portId });
  }
  graph.nodes.push(proxy);
  graph.expandedNodes = mediaNodes;
  aliasSharedAudio();
  return endpoints;
}
