import { act, renderHook, cleanup } from '@testing-library/react';
import { useNodeCanvasPlacement } from '../../src/components/panels/nodes/canvas/useNodeCanvasPlacement';
import { createMockClip } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { describe, expect, it } from 'vitest';
import { reconcileCanvasPlacement, moveCanvasPlacement, resetCanvasPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { groupHeaderMetrics } from '../../src/components/panels/nodes/canvas/groupHeaderMetrics';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from '../../src/components/panels/nodes/canvas/canvasGeometry';

const graph: NodeGraph = { ...connectionFixture, edges: [],
  nodes: ['a', 'b', 'c'].map((id, i) => ({ ...connectionFixture.nodes[0], id, layout: { x: i * 400, y: 100 } })),
  groups: [
    { id: 'outer', label: 'Effect', proxyId: 'proxy', color: '#aaa', collapsed: false, nodeIds: ['a', 'b'] },
    { id: 'inner', label: 'Inner', proxyId: 'inner-proxy', color: '#aaa', collapsed: false, nodeIds: ['b'], parentId: 'outer' },
  ],
};

describe('manual canvas placement', () => {
  it('reset replaces persisted manual placement and stays stable on subsequent renders', () => {
    const clip = createMockClip({ id: graph.owner.id, effects: [] });
    const previous = useTimelineStore.getState().clips;
    try {
      useTimelineStore.setState({ clips: [clip] });
      const hook = renderHook(() => useNodeCanvasPlacement(graph, 1));
      act(() => hook.result.current.commit([{ nodeId: 'a', layout: { x: 9000, y: 5000 } }], 'outer'));
      expect(hook.result.current.placement.nodes.a.x).toBe(9000);
      act(() => hook.result.current.reset());
      expect(hook.result.current.placement.pinned).toEqual({});
      expect(hook.result.current.placement.nodes.a.x).toBeLessThan(9000);
      const reset = hook.result.current.placement.nodes;
      hook.rerender();
      expect(hook.result.current.placement.nodes).toEqual(reset);
      expect(useTimelineStore.getState().clips[0].nodeGraph?.canvasPlacements?.[graph.id]?.pinned).toEqual({});
    } finally { cleanup(); useTimelineStore.setState({ clips: previous }); }
  });

  it('reset clears manual anchors, displaced positions and group offsets', () => {
    const initial = resetCanvasPlacement(graph);
    const moved = moveCanvasPlacement(initial, [{ nodeId: 'a', layout: { x: 9000, y: 5000 } }], 'outer');
    expect(moved.pinned?.a).toBe(true);
    const reset = resetCanvasPlacement(graph);
    expect(reset.nodes).toEqual(initial.nodes);
    expect(reset.pinned).toEqual({});
    expect(reset.displaced).toEqual({});
    expect(reset.groups.outer.offset).toEqual({ x: 0, y: 0 });
  });
  it('pushes unrelated anchored cards and whole sibling groups out of a newly expanded frame', () => {
    const expanded: NodeGraph = { ...graph, nodes: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ ...graph.nodes[0], id,
      layout: { x: i === 1 ? 1200 : i * 450, y: i > 1 ? 500 : 100 } })),
      groups: [{ id: 'outer', label: 'Effect', proxyId: 'proxy', nodeIds: ['a', 'b'], collapsed: false },
        { id: 'sibling', label: 'Other', proxyId: 'other-proxy', nodeIds: ['d', 'e'], collapsed: false }] };
    const initial = reconcileCanvasPlacement(expanded);
    const compact = { ...expanded, nodes: [{ ...expanded.nodes[0], id: 'proxy' }, ...expanded.nodes.slice(2)],
      groups: expanded.groups!.map(group => group.id === 'outer' ? { ...group, collapsed: true, nodeIds: ['proxy'] } : group) };
    let placed = reconcileCanvasPlacement(compact, initial);
    placed = moveCanvasPlacement(placed, [{ nodeId: 'c', layout: { x: 400, y: 100 } }]);
    placed = moveCanvasPlacement(placed, [{ nodeId: 'd', layout: { x: 700, y: 100 } }], 'sibling');
    const beforeDelta = { x: placed.nodes.e.x - placed.nodes.d.x, y: placed.nodes.e.y - placed.nodes.d.y };
    const after = reconcileCanvasPlacement(expanded, placed), nodes = expanded.nodes.map(node => ({ ...node, layout: after.nodes[node.id] }));
    const box = nodeGroupBounds(expanded, nodes).get('outer')!;
    expect(after.nodes.a).toEqual(initial.nodes.a); expect(after.nodes.b).toEqual(initial.nodes.b);
    for (const node of nodes.filter(node => ['c', 'd', 'e'].includes(node.id))) expect(node.layout.x >= box.right || node.layout.x + NODE_WIDTH <= box.left
      || node.layout.y >= box.bottom || node.layout.y + getNodeHeight(node) <= box.top, node.id).toBe(true);
    expect({ x: after.nodes.e.x - after.nodes.d.x, y: after.nodes.e.y - after.nodes.d.y }).toEqual(beforeDelta);
    expect(reconcileCanvasPlacement(expanded, after).nodes).toEqual(after.nodes);
    const closed = reconcileCanvasPlacement(compact, after);
    for (const id of ['c', 'd', 'e']) expect(closed.nodes[id]).toEqual(placed.nodes[id]);
    const openedAgain = reconcileCanvasPlacement(expanded, closed);
    for (const id of ['c', 'd', 'e']) expect(openedAgain.nodes[id]).toEqual(after.nodes[id]);
    const manual = { x: after.nodes.c.x + 200, y: after.nodes.c.y + 300 };
    const edited = moveCanvasPlacement(after, [{ nodeId: 'c', layout: manual }]);
    expect(reconcileCanvasPlacement(compact, edited).nodes.c).toEqual(manual);
  });
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


describe('effect addition layout', () => {
  it.each(['invert', 'wave', 'voxel-relief', 'analog-signal-lab'])('moves the output out and back for %s with the common fold rules', type => {
    const beforeClips = useTimelineStore.getState().clips;
    const clip = createMockClip({ id: 'universal-fold', effects: [] });
    try {
      useTimelineStore.setState({ clips: [clip] });
      const effectId = useTimelineStore.getState().addClipEffect(clip.id, type)!;
      const current = useTimelineStore.getState().clips[0];
      const project = (collapsed: boolean) => {
        const value = { ...current, nodeGraph: { ...current.nodeGraph, version: 1 as const, nodes: current.nodeGraph?.nodes ?? [],
          groups: { ...current.nodeGraph?.groups, [`effect:${effectId}`]: { collapsed } } } };
        return buildUnifiedClipGraph(buildClipNodeGraphDocument(value), value);
      };
      const compact = project(true), expanded = project(false);
      expect(expanded.groups!.find(group => group.effectId === effectId)?.layoutMode).toBe('flow');
      const closed = reconcileCanvasPlacement(compact), opened = reconcileCanvasPlacement(expanded, closed);
      const nodes = expanded.nodes.map(node => ({ ...node, layout: opened.nodes[node.id] }));
      const bounds = nodeGroupBounds(expanded, nodes).get(`effect:${effectId}`)!;
      expect(opened.nodes.output.x).toBeGreaterThan(bounds.right);
      expect(opened.nodes.output.x).toBeGreaterThan(closed.nodes.output.x);
      const closedAgain = reconcileCanvasPlacement(compact, opened);
      expect(closedAgain.nodes.output.x).toBeCloseTo(closed.nodes.output.x);
      const reopened = reconcileCanvasPlacement(expanded, closedAgain);
      expect(reopened.nodes.output).toEqual(opened.nodes.output);
    } finally { useTimelineStore.setState({ clips: beforeClips }); }
  });

  it.each(['brightness', 'kaleidoscope'])('reflows the existing output when the effect panel adds %s', type => {
    const clip = createMockClip({ id: 'layout-add', effects: [] });
    const project = () => {
      const current = useTimelineStore.getState().clips.find(item => item.id === clip.id)!;
      return buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
    };
    const previousClips = useTimelineStore.getState().clips;
    try {
      useTimelineStore.setState({ clips: [clip] });
      const before = reconcileCanvasPlacement(project());
      const effectId = useTimelineStore.getState().addClipEffect(clip.id, type);
      const graph = project();
      const after = reconcileCanvasPlacement(graph, before);
      const members = graph.groups?.find(group => group.effectId === effectId)?.nodeIds ?? [`effect-${effectId}`];
      expect(after.nodes.output.x).toBeGreaterThan(Math.max(...members.map(id => after.nodes[id].x + NODE_WIDTH)));
      expect(reconcileCanvasPlacement(graph, after).nodes.output).toEqual(after.nodes.output);
    } finally { useTimelineStore.setState({ clips: previousClips }); }
  });
});
