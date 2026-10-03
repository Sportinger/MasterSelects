import { compositionTrackStripView } from '../../src/services/nodeGraph/composition/compositionTrackStripView';
import { layoutWorkspaceExpansion } from '../../src/components/panels/nodes/unified/layoutWorkspaceExpansion';
import { describe, expect, it, vi } from 'vitest';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphProjection';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { buildCompositionGraph, compositionNodeId, compositionGroupId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { namespaceClipGraph } from '../../src/services/nodeGraph/unified/namespaceClipGraph';
import { collectOpenClipProjections, embedWorkspaceGraph, workspaceClipRoot } from '../../src/services/nodeGraph/unified/embedWorkspaceGraph';
import { workspaceClipId, workspaceClipOwner, resolveWorkspaceClipOwner } from '../../src/services/nodeGraph/unified/workspaceIds';
import { getGraphBounds, getNodeHeight, getNodeWidth } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { hitSummarySegment } from '../../src/components/panels/nodes/canvas/hitSummarySegment';

const track = createMockTrack({ id: 'video', type: 'video' });
const audioTrack = createMockTrack({ id: 'audio', type: 'audio' });
const clip = createMockClip({ id: 'video:one::/', trackId: track.id, mediaFileId: 'media', effects: [], linkedClipId: 'audio' });
const audio = createMockClip({ id: 'audio', trackId: audioTrack.id, mediaFileId: 'media', linkedClipId: clip.id, effects: [], source: { type: 'audio' } });
function projection(graph: NodeGraph) {
  return { graph, bounds: getGraphBounds(graph), placement: { nodes: Object.fromEntries(graph.nodes.map(node => [node.id, node.layout])), groups: {} } };
}
function clipGraph() {
  return buildUnifiedClipGraph(buildClipNodeGraphDocument(clip, track, { linkedClip: audio, linkedTrack: audioTrack }), clip, [clip, audio]);
}
const composition = () => buildCompositionGraph({ compositionId: 'main', compositionName: 'Main', clips: [clip, audio], tracks: [track, audioTrack], media: new Map() });

describe('shared workspace graph ownership and embedding', () => {
  it('round-trips arbitrary clip ids and local node, edge and group ids', () => {
    for (const clipId of ['a', 'clip:with::separators/%', '??']) for (const localId of ['source', 'effect:a/group/@x', '["a","b"]']) {
      expect(workspaceClipOwner(workspaceClipId(clipId, localId))).toEqual({ clipId, localId });
    }
    expect(workspaceClipOwner('comp:clip:one')).toBeNull();
    expect(workspaceClipOwner('clip:%broken::source')).toBeNull();
  });
  it('namespaces nested endpoints without changing domain bindings or local data', () => {
    const original = clipGraph(), before = JSON.stringify(original);
    const embedded = namespaceClipGraph(original, clip.id, { x: 123, y: 456 });
    embedded.nodes.forEach((node, index) => {
      expect(node.id).toBe(workspaceClipId(clip.id, original.nodes[index].id));
      expect(node.binding).toEqual(original.nodes[index].binding);
      expect(node.layout).toEqual({ x: original.nodes[index].layout.x + 123, y: original.nodes[index].layout.y + 456 });
    });
    expect(JSON.stringify(original)).toBe(before);
  });
  it('replaces the card cables with media/source and image/audio output/track seams', () => {
    const base = composition(), before = JSON.stringify(base);
    const graph = embedWorkspaceGraph(base, new Map([[clip.id, projection(clipGraph())]]));
    const source = graph.nodes.find(node => node.binding?.kind === 'clip-source')!;
    const output = graph.nodes.find(node => node.binding?.kind === 'clip-output')!;
    const audioOutput = graph.nodes.find(node => node.outputs.some(port => port.id === 'workspace-audio-track'))!;
    expect(source).toBeDefined(); expect(output).toBeDefined(); expect(audioOutput).toBeDefined();
    expect(graph.nodes.some(node => node.id === compositionNodeId.clip(clip.id))).toBe(false);
    expect(graph.edges.some(edge => edge.toNodeId === source.id && edge.fromNodeId === `${compositionGroupId.media()}:proxy`)).toBe(true);
    expect(graph.edges.some(edge => edge.fromNodeId === output.id && edge.toNodeId === compositionNodeId.track(track.id) && edge.type === 'texture')).toBe(true);
    expect(graph.edges.some(edge => edge.fromNodeId === audioOutput.id && edge.toNodeId === compositionNodeId.track(audioTrack.id) && edge.type === 'audio')).toBe(true);
    expect(graph.edges.some(edge => edge.fromNodeId === compositionNodeId.clip(clip.id) || edge.toNodeId === compositionNodeId.clip(clip.id))).toBe(false);
    expect(JSON.stringify(base)).toBe(before);
    const root = workspaceClipRoot(clip.id, projection(clipGraph()));
    expect(root.nodes.map(node => node.id)).toEqual(graph.nodes.filter(node => node.workspaceOwner).map(node => node.id));
  });
  it('never routes a composition id or an unopened clip to clip actions', () => {
    const graph = embedWorkspaceGraph(composition(), new Map([[clip.id, projection(clipGraph())]]));
    expect(resolveWorkspaceClipOwner(graph, compositionNodeId.clip(clip.id))).toBeNull();
    expect(resolveWorkspaceClipOwner(graph, 'composition:main')).toBeNull();
    expect(resolveWorkspaceClipOwner(graph, workspaceClipId('absent', 'source'))).toBeNull();
    expect(resolveWorkspaceClipOwner(graph, workspaceClipId(clip.id, 'source'))?.clipId).toBe(clip.id);
  });
  it('does no clip projection work for collapsed cards', () => {
    const build = vi.fn(() => projection(clipGraph()));
    const graph = embedWorkspaceGraph(composition(), collectOpenClipProjections([], build));
    expect(build).not.toHaveBeenCalled();
    expect(graph.nodes.filter(node => node.binding?.kind === 'composition-clip')).toHaveLength(1);
    expect(graph.nodes.some(node => node.workspaceOwner)).toBe(false);
    collectOpenClipProjections([clip.id], build);
    expect(build).toHaveBeenCalledTimes(1);
  });
  it('lays out 30 strip segments on 3 tracks with two expanded subgraphs without overlapping cards', () => {
    const tracks = Array.from({ length: 3 }, (_, i) => createMockTrack({ id: `t${i}`, type: 'video' }));
    const clips = Array.from({ length: 30 }, (_, i) => createMockClip({ id: `c${i}`, trackId: tracks[i % 3].id, startTime: i * 1000, mediaFileId: 'shared', effects: [] }));
    const opened = collectOpenClipProjections(['c0', 'c7'], id => {
      const clip = clips.find(clip => clip.id === id)!;
      return projection(buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, clips));
    });
    const base = buildCompositionGraph({ compositionId: 'many', compositionName: 'Many', tracks, clips, media: new Map() });
    const strips = compositionTrackStripView(base, { expandedClipIds: new Set(opened.keys()) });
    const graph = layoutWorkspaceExpansion(embedWorkspaceGraph(strips, opened), strips);
    for (const [index, a] of graph.nodes.entries()) for (const b of graph.nodes.slice(index + 1)) {
      expect(a.layout.x + getNodeWidth(a) <= b.layout.x || b.layout.x + getNodeWidth(b) <= a.layout.x
        || a.layout.y + getNodeHeight(a) <= b.layout.y || b.layout.y + getNodeHeight(b) <= a.layout.y,
      `${a.id} overlaps ${b.id}`).toBe(true);
    }
    expect(base.nodes.find(node => node.id === compositionNodeId.track('t0'))!.layout.x).toBeLessThan(10000);
  });
  it('deduplicates linked media and provides a screen-space segment hit before card dragging', () => {
    const graph = buildCompositionGraph({ compositionId: 'main', compositionName: 'Main', clips: [clip, audio], tracks: [track, audioTrack], media: new Map(),
      state: { version: 1, layout: { nodes: {}, collapsed: { [compositionGroupId.media()]: false } } } });
    const media = graph.nodes.find(node => node.binding?.kind === 'composition-media')!;
    expect(media.summary?.segments).toHaveLength(1);
    expect(hitSummarySegment([media], media.layout.x + 14, media.layout.y + 105, 0.2)?.segmentId).toBe(`piece:${clip.id}`);
  });
});
