import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEdgeGroupOcclusion, edgeGroupOcclusion, pointBehindGroup, subtractOccludedRects } from '../../src/components/panels/nodes/canvas/edgeGroupOcclusion';
import { NodeGraphEdges } from '../../src/components/panels/nodes/canvas/NodeGraphEdges';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import type { NodeGraph } from '../../src/types/nodeGraph';

afterEach(cleanup);
describe('wires passing behind groups', () => {
  it('subtracts overlapping covers without reopening a hit area', () => {
    const covers = [{ x: 20, y: 20, width: 60, height: 60 }, { x: 40, y: 40, width: 50, height: 50 }];
    const visible = subtractOccludedRects({ x: 0, y: 0, width: 100, height: 100 }, covers);
    expect(pointBehindGroup({ x: 50, y: 50 }, visible)).toBe(false);
    expect(pointBehindGroup({ x: 10, y: 10 }, visible)).toBe(true);
  });
  it('clips the actual SVG interaction path and dims the noninteractive covered path to 30 percent', () => {
    const graph: NodeGraph = { ...connectionFixture, nodes: [...connectionFixture.nodes,
      { ...connectionFixture.nodes[0], id: 'foreign', layout: { x: 100, y: 0 } }],
      groups: [{ id: 'foreign-group', label: 'Foreign', color: '#fff', collapsed: false, proxyId: 'proxy', nodeIds: ['foreign'] }] };
    const bounds = nodeGroupBounds(graph, graph.nodes), byId = new Map(graph.nodes.map(node => [node.id, node]));
    expect(edgeGroupOcclusion(graph.edges[0], graph, bounds)).toHaveLength(1);
    expect(edgeGroupOcclusion({ ...graph.edges[0], fromNodeId: 'foreign' }, graph, bounds)).toHaveLength(0);
    const covers = createEdgeGroupOcclusion(graph, bounds);
    expect(covers({ ...graph.edges[0], id: 'another-wire' })).toBe(covers(graph.edges[0]));
    expect(covers({ ...graph.edges[0], fromNodeId: 'foreign' })).toEqual([]);
    const view = render(<NodeGraphEdges graph={graph} edges={graph.edges} graphBounds={{ left: 0, top: 0, right: 1500, bottom: 1000 }}
      nodesById={byId} plugs={getConnectionPlugs(graph.edges, byId)} zoom={1} selectedEdgeId={null} hoveredEdgeId={null}
      connectionDraft={null} onSelectEdge={vi.fn()} onClearSelectedEdge={vi.fn()} />);
    const hit = view.container.querySelector('.node-workspace-edge-hit')!;
    expect(hit.parentElement?.getAttribute('clip-path')).toMatch(/^url\(#/);
    expect(view.container.querySelector('path[style*="opacity: 0.3"]')).toHaveStyle({ pointerEvents: 'none' });
    for (const clip of view.container.querySelectorAll('clipPath')) {
      expect(clip.children).toHaveLength(1);
      expect(clip.firstElementChild?.tagName).toBe('path');
      expect(clip.firstElementChild?.getAttribute('clip-rule')).toBe('nonzero');
    }
  });
});
