import { describe, expect, it } from 'vitest';
import { reconcileCanvasPlacement, moveCanvasPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { groupHeaderMetrics } from '../../src/components/panels/nodes/canvas/groupHeaderMetrics';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';

const graph: NodeGraph = { ...connectionFixture, edges: [],
  nodes: ['a', 'b', 'c'].map((id, i) => ({ ...connectionFixture.nodes[0], id, layout: { x: i * 400, y: 100 } })),
  groups: [
    { id: 'outer', label: 'Effect', proxyId: 'proxy', color: '#aaa', collapsed: false, nodeIds: ['a', 'b'] },
    { id: 'inner', label: 'Inner', proxyId: 'inner-proxy', color: '#aaa', collapsed: false, nodeIds: ['b'], parentId: 'outer' },
  ],
};

describe('manual canvas placement', () => {
  it('allows overlap, retaining exact coordinates through graph edits and serialization', () => {
    const initial = reconcileCanvasPlacement(graph);
    const moved = moveCanvasPlacement(initial, [{ nodeId: 'a', layout: initial.nodes.c }]);
    const saved = cloneClipNodeGraph({ version: 1, nodes: [], canvasPlacements: { [graph.id]: moved } })!;
    expect(saved.canvasPlacements![graph.id]).not.toBe(moved);
    const restored = reconcileCanvasPlacement({ ...graph, nodes: graph.nodes.map(node => ({ ...node, label: 'Edited', layout: { x: 0, y: 0 } })) }, saved.canvasPlacements![graph.id]);
    expect(restored.nodes).toEqual(moved.nodes);
    expect(restored.nodes.a).toEqual(restored.nodes.c);
  });

  it('places only new nodes while leaving overlapping existing nodes untouched', () => {
    const initial = reconcileCanvasPlacement({ ...graph, groups: [] });
    const moved = moveCanvasPlacement(initial, [{ nodeId: 'a', layout: initial.nodes.b }]);
    const next = reconcileCanvasPlacement({ ...graph, groups: [], nodes: [...graph.nodes,
      { ...graph.nodes[0], id: 'new', layout: moved.nodes.b }] }, moved);
    for (const node of graph.nodes) expect(next.nodes[node.id]).toEqual(moved.nodes[node.id]);
    expect(next.nodes.new).not.toEqual(moved.nodes.b);
  });

  it('moves the complete nested group without changing unrelated nodes', () => {
    const initial = reconcileCanvasPlacement(graph);
    const delta = { x: -900, y: 50 };
    const moved = moveCanvasPlacement(initial, [{ nodeId: 'a', layout: { x: initial.nodes.a.x + delta.x, y: initial.nodes.a.y + delta.y } }], 'outer');
    expect(moved.nodes.b).toEqual({ x: initial.nodes.b.x + delta.x, y: initial.nodes.b.y + delta.y });
    expect(moved.nodes.c).toEqual(initial.nodes.c);
    expect(reconcileCanvasPlacement(graph, moved).nodes).toEqual(moved.nodes);
  });

  it('moves hidden descendants with a folded proxy and restores them on expansion', () => {
    const initial = reconcileCanvasPlacement(graph);
    const folded = { ...graph, nodes: [{ ...graph.nodes[0], id: 'proxy' }, graph.nodes[2]],
      groups: [{ ...graph.groups![0], collapsed: true, nodeIds: ['proxy'] }] };
    const collapsed = reconcileCanvasPlacement(folded, initial);
    const moved = moveCanvasPlacement(collapsed, [{ nodeId: 'proxy', layout: { x: collapsed.nodes.proxy.x + 150, y: collapsed.nodes.proxy.y - 90 } }], 'outer');
    const expanded = reconcileCanvasPlacement(graph, moved);
    for (const id of ['a', 'b']) expect(expanded.nodes[id]).toEqual({ x: initial.nodes[id].x + 150, y: initial.nodes[id].y - 90 });
    expect(expanded.nodes.c).toEqual(initial.nodes.c);
  });

  it('adjusts only text at minimum zoom, keeping frames and header heights unchanged', () => {
    const zoom = 0.18, metrics = groupHeaderMetrics(zoom), bounds = nodeGroupBounds(graph, graph.nodes);
    expect(metrics.fontSize).toBeGreaterThan(groupHeaderMetrics(1).fontSize);
    expect(metrics.fontSize).toBeLessThan(metrics.height);
    expect(metrics.controlSize).toBe(28);
    expect(metrics.height).toBe(34);
    expect(metrics.height).toBe(groupHeaderMetrics(1).height);
    expect(bounds.get('outer')!.top + metrics.height).toBeLessThan(bounds.get('inner')!.top);
    expect(bounds.get('inner')!.top + metrics.height).toBeLessThan(graph.nodes[1].layout.y);
  });
});
