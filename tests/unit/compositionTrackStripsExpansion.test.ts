import { describe, expect, it } from 'vitest';
import type { NodeGraph, NodeGraphNode } from '../../src/types/nodeGraph';
import type { WorkspaceClipProjection } from '../../src/services/nodeGraph/unified/embedWorkspaceGraph';
import { embedWorkspaceGraph, workspaceClipRoot } from '../../src/services/nodeGraph/unified/embedWorkspaceGraph';
import { compositionTrackStripView } from '../../src/services/nodeGraph/composition/compositionTrackStripView';
import { buildCompositionGraph } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { compositionPort } from '../../src/services/nodeGraph/composition/compositionGraphPrimitives';
import { layoutWorkspaceExpansion } from '../../src/components/panels/nodes/unified/layoutWorkspaceExpansion';
import { getGraphBounds, getNodeHeight, getNodeWidth } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { workspaceClipGroup } from '../../src/services/nodeGraph/unified/workspaceIds';
import { undisplacedWorkspacePoint } from '../../src/services/nodeGraph/unified/expansionDisplacement';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const localNode = (id: string, kind: 'clip-source' | 'clip-output', x: number, y: number): NodeGraphNode => ({
  id, binding: { kind }, kind: kind === 'clip-source' ? 'source' : 'output', runtime: 'builtin', label: id, layout: { x, y },
  inputs: kind === 'clip-output' ? [compositionPort('image', 'Image', 'texture', 'input')] : [],
  outputs: kind === 'clip-source' ? [compositionPort('image', 'Image', 'texture', 'output')] : [],
});
const clipGraph: NodeGraph = { id: 'clip-v', owner: { kind: 'clip', id: 'v', name: 'Video' },
  nodes: [localNode('source', 'clip-source', 0, 0), localNode('output', 'clip-output', 600, 400)],
  edges: [{ id: 'image', type: 'texture', fromNodeId: 'source', fromPortId: 'image', toNodeId: 'output', toPortId: 'image' }] };
const projection: WorkspaceClipProjection = { graph: clipGraph, bounds: getGraphBounds(clipGraph), placement: { nodes: {}, groups: {} } };

describe('track strips with inline clip expansion', () => {
  it('keeps seams and shared track x, displaces by actual bounds, and restores pure anchors on collapse', () => {
    const composition = buildCompositionGraph({ compositionId: 'main', compositionName: 'Main',
      clips: [createMockClip({ id: 'v', trackId: 'v', duration: 5 }), createMockClip({ id: 'other', trackId: 'v2', duration: 5 })],
      tracks: [createMockTrack({ id: 'v' }), createMockTrack({ id: 'v2' })], media: new Map() });
    const before = JSON.stringify(composition);
    const view = compositionTrackStripView(composition, { expandedClipIds: new Set(['v']) });
    const graph = layoutWorkspaceExpansion(embedWorkspaceGraph(view, new Map([['v', projection]])), view);
    expect(graph.workspace!.clips.v).toBeDefined();
    const strips = graph.nodes.filter(node => node.binding?.kind === 'composition-track');
    expect(new Set(strips.map(node => node.layout.x)).size).toBe(1);
    const box = nodeGroupBounds(graph, graph.nodes).get(workspaceClipGroup('v'))!;
    for (const node of strips) expect(box.left < node.layout.x + getNodeWidth(node) && box.right > node.layout.x
      && box.top < node.layout.y + getNodeHeight(node) && box.bottom > node.layout.y).toBe(false);
    expect(graph.edges.some(edge => edge.toPortId === 'workspace-media')).toBe(true);
    expect(graph.edges.some(edge => edge.fromPortId === 'workspace-video-track' && edge.toNodeId === 'comp:track:v')).toBe(true);
    for (const node of strips) expect(undisplacedWorkspacePoint(node.layout, graph.workspace!.compositionOffsets?.[node.id]))
      .toEqual(composition.nodes.find(original => original.id === node.id)!.layout);
    const closed = compositionTrackStripView(composition);
    // Closed lanes sit as rows under their strip; every shift is a recorded presentation offset.
    for (const node of closed.nodes) expect(undisplacedWorkspacePoint(node.layout, closed.workspace!.compositionOffsets?.[node.id]))
      .toEqual(composition.nodes.find(original => original.id === node.id)!.layout);
    expect(JSON.stringify(composition)).toBe(before);
  });

  it('leaves clip-root projection free of composition strips and folding', () => {
    const before = JSON.stringify(clipGraph), root = workspaceClipRoot('v', projection);
    expect(root.nodes).toHaveLength(2);
    expect(root.nodes.every(node => !node.summary?.timeAxis)).toBe(true);
    expect(JSON.stringify(clipGraph)).toBe(before);
  });
});
