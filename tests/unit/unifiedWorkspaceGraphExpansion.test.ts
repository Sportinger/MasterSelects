import { describe, expect, it } from 'vitest';
import type { NodeGraph } from '../../src/types/nodeGraph';
import type { CompositionGraphState } from '../../src/types/compositionGraph';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphProjection';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { buildCompositionGraph } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { embedWorkspaceGraph, type WorkspaceClipProjection } from '../../src/services/nodeGraph/unified/embedWorkspaceGraph';
import { workspaceClipGroup } from '../../src/services/nodeGraph/unified/workspaceIds';
import { undisplacedWorkspacePoint } from '../../src/services/nodeGraph/unified/expansionDisplacement';
import { layoutWorkspaceExpansion } from '../../src/components/panels/nodes/unified/layoutWorkspaceExpansion';
import { getGraphBounds, getNodeHeight, NODE_WIDTH, type NodeBounds } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';

const tracks = [createMockTrack({ id: 'video', type: 'video' }), createMockTrack({ id: 'audio', type: 'audio' })];
const clips = Array.from({ length: 4 }, (_, i) => [
  createMockClip({ id: `v${i}`, trackId: 'video', linkedClipId: `a${i}`, mediaFileId: 'shared', startTime: i * 5, effects: [] }),
  createMockClip({ id: `a${i}`, trackId: 'audio', linkedClipId: `v${i}`, mediaFileId: 'shared', startTime: i * 5, effects: [], source: { type: 'audio' } }),
]).flat();
const rules: CompositionGraphState['rules'] = { beats: { id: 'beats', operator: 'beat-distribute', schemaVersion: 1,
  label: 'Beat rule', source: { kind: 'tempo-map' }, beatSnapshot: [0, 5, 10, 15], sourceRevision: 'r1', status: { state: 'ok' },
  members: clips.filter(clip => clip.trackId === 'video').map(clip => ({ clipId: clip.id, memberId: clip.id })),
  params: { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: 'video' } } };
const build = (state?: CompositionGraphState) => buildCompositionGraph({ compositionId: 'main', compositionName: 'Main',
  clips, tracks, media: new Map(), state: state ?? { version: 1, rules } });
function opened(ids: string[]) {
  return new Map<string, WorkspaceClipProjection>(ids.map(id => {
    const clip = clips.find(clip => clip.id === id)!;
    const linked = clips.find(other => other.id === clip.linkedClipId)!;
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip, tracks[0], { linkedClip: linked, linkedTrack: tracks[1] }), clip, clips);
    // Include negative clip-local coordinates, as after a manual internal drag.
    graph.nodes = graph.nodes.map(node => ({ ...node, layout: { x: node.layout.x - 500, y: node.layout.y - 200 } }));
    return [id, { graph, bounds: getGraphBounds(graph), placement: { nodes: Object.fromEntries(graph.nodes.map(node => [node.id, node.layout])), groups: {} } }];
  }));
}
const overlap = (a: NodeBounds, b: NodeBounds) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function assertClear(graph: NodeGraph, ids: string[]) {
  const groups = nodeGroupBounds(graph, graph.nodes);
  for (const id of ids) {
    const box = groups.get(workspaceClipGroup(id))!;
    expect(box).toBeDefined();
    for (const node of graph.nodes.filter(node => node.workspaceOwner?.clipId !== id)) {
      expect(overlap(box, { left: node.layout.x, right: node.layout.x + NODE_WIDTH,
        top: node.layout.y, bottom: node.layout.y + getNodeHeight(node) }), `${id} overlaps ${node.id}`).toBe(false);
    }
    for (const other of ids.filter(other => other !== id)) expect(overlap(box, groups.get(workspaceClipGroup(other))!)).toBe(false);
  }
}

describe('inline expansion over saved composition anchors', () => {
  for (const ids of [['v0'], ['v0', 'v1'], ['v0', 'v3']]) it(`keeps fully saved Arrange positions clear with ${ids.join(', ')} open`, () => {
    const arranged = build();
    const state: CompositionGraphState = { version: 1, rules, layout: {
      nodes: Object.fromEntries(arranged.nodes.map(node => [node.id, node.defaultLayout ?? node.layout])),
    } };
    const base = build(state), projections = opened(ids), before = JSON.stringify({ base, state, projections: [...projections] });
    const graph = layoutWorkspaceExpansion(embedWorkspaceGraph(base, projections), base);
    assertClear(graph, ids);
    expect(graph.workspace!.defaultNodes).toEqual(state.layout!.nodes);
    expect(JSON.stringify({ base, state, projections: [...projections] })).toBe(before);
    expect(layoutWorkspaceExpansion(embedWorkspaceGraph(base, projections), base)).toEqual(graph);
    // Closing all clips returns exactly to the stored, undisplaced positions.
    const closed = layoutWorkspaceExpansion(embedWorkspaceGraph(base, new Map()), base);
    for (const node of closed.nodes) expect(node.layout).toEqual(state.layout!.nodes[node.id]);
    const rule = graph.nodes.find(node => node.binding?.kind === 'composition-rule')!;
    const beat = graph.nodes.find(node => node.binding?.kind === 'composition-beat-source')!;
    for (const node of [rule, beat]) {
      expect(node.layout.y).toBeGreaterThan(state.layout!.nodes[node.id].y);
      const moved = { x: node.layout.x + 17, y: node.layout.y - 9 };
      expect(undisplacedWorkspacePoint(moved, graph.workspace!.compositionOffsets![node.id])).toEqual({
        x: state.layout!.nodes[node.id].x + 17, y: state.layout!.nodes[node.id].y - 9,
      });
    }
    for (const [id, entry] of Object.entries(graph.workspace!.clips)) {
      for (const node of graph.nodes.filter(node => node.workspaceOwner?.clipId === id)) {
        expect(undisplacedWorkspacePoint(node.layout, entry.origin)).toEqual(entry.graph.nodes.find(local => local.id === node.workspaceOwner!.localId)!.layout);
      }
    }
  });
  it('resolves arbitrary saved collisions with two expanded clips, tall cards and nested frames', () => {
    const arranged = build(), state: CompositionGraphState = { version: 1, rules, layout: {
      nodes: Object.fromEntries(arranged.nodes.map(node => [node.id, { x: 300, y: 80 }])),
    } };
    const base = build(state), projections = opened(['v0', 'v1']);
    const local = projections.get('v0')!.graph;
    local.groups!.push({ id: 'test-frame', proxyId: local.nodes[0].id, label: 'Tall frame', color: '#888', collapsed: false,
      nodeIds: local.nodes.map(node => node.id), size: { width: 2000, height: 1800 } });
    const graph = layoutWorkspaceExpansion(embedWorkspaceGraph(base, projections), base);
    assertClear(graph, ['v0', 'v1']);
  });
});
