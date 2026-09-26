import { describe, expect, it } from 'vitest';
import { compactFlowColumns } from '../../src/components/panels/nodes/canvas/compactFlowColumns';
import { reconcileCanvasPlacement, moveCanvasPlacement, arrangeFlowPlacement, resetCanvasPlacement, toggleCompactEffectPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';

const graph: NodeGraph = { ...connectionFixture,
  nodes: Array.from({ length: 12 }, (_, i) => ({ ...connectionFixture.nodes[0], id: `n${i}`, layout: { x: i * 300, y: 0 } })),
  edges: Array.from({ length: 11 }, (_, i) => ({ id: `e${i}`, fromNodeId: `n${i}`, toNodeId: `n${i + 1}`,
    fromPortId: 'out', toPortId: 'in', type: 'texture' })),
  groups: [0, 1].map(i => ({ id: `effect${i}`, label: `Effect ${i}`, proxyId: `proxy${i}`, layoutMode: 'flow',
    nodeIds: Array.from({ length: 6 }, (_, j) => `n${i * 6 + j}`) })),
};

describe('compact top-level effect layout', () => {
  it('switches back to horizontal flow, persists the choice, and preserves it through Arrange and Reset', () => {
    const compact = reconcileCanvasPlacement(graph);
    const horizontal = toggleCompactEffectPlacement(graph, compact);
    expect(horizontal.compactEffects).toBe(false);
    expect(horizontal.nodes.n6.x).toBeGreaterThan(horizontal.nodes.n5.x);
    expect(horizontal.nodes.n6.y).toBe(horizontal.nodes.n0.y);
    const restored = reconcileCanvasPlacement(graph, JSON.parse(JSON.stringify(horizontal)));
    expect(restored.nodes).toEqual(horizontal.nodes);
    for (const placement of [arrangeFlowPlacement(graph, restored), resetCanvasPlacement(graph, false)]) {
      expect(placement.compactEffects).toBe(false);
      expect(placement.nodes.n6.x).toBeGreaterThan(placement.nodes.n5.x);
    }
    const compactAgain = toggleCompactEffectPlacement(graph, restored);
    expect(compactAgain.nodes).toEqual(compact.nodes);
  });
  it('stacks wide effects while preserving the left-to-right layout of every interior', () => {
    const before = JSON.stringify(graph);
    const placement = reconcileCanvasPlacement(graph);
    const nodes = graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] }));
    const bounds = nodeGroupBounds(graph, nodes);
    const a = bounds.get('effect0')!, b = bounds.get('effect1')!;
    expect(b.left).toBe(a.left);
    expect(b.top).toBeGreaterThan(a.bottom);
    for (const group of graph.groups!) {
      const isolated = reconcileCanvasPlacement({ ...graph, nodes: graph.nodes.filter(node => group.nodeIds.includes(node.id)),
        edges: graph.edges.filter(edge => group.nodeIds.includes(edge.fromNodeId) && group.nodeIds.includes(edge.toNodeId)), groups: [group] });
      const first = group.nodeIds[0];
      for (const id of group.nodeIds) {
        expect(placement.nodes[id].x - placement.nodes[first].x).toBe(isolated.nodes[id].x - isolated.nodes[first].x);
        expect(placement.nodes[id].y - placement.nodes[first].y).toBe(isolated.nodes[id].y - isolated.nodes[first].y);
      }
    }
    expect(reconcileCanvasPlacement(graph, placement).nodes).toEqual(placement.nodes);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps manual group moves until Arrange and then restores the compact layout', () => {
    const initial = reconcileCanvasPlacement(graph);
    const moved = moveCanvasPlacement(initial, [{ nodeId: 'n6', layout: { x: 6000, y: 3000 } }], 'effect1');
    expect(reconcileCanvasPlacement(graph, moved).nodes).toEqual(moved.nodes);
    const arranged = arrangeFlowPlacement(graph, moved);
    expect(arranged.nodes.n6.x).toBe(arranged.nodes.n0.x);
    expect(arranged.nodes.n6.y).toBeGreaterThan(arranged.nodes.n0.y);
    expect(reconcileCanvasPlacement(graph, arranged).nodes).toEqual(arranged.nodes);
  });

  it('uses measured frames, keeps source/output at the sides and avoids overlaps', () => {
    const blocks = Array.from({ length: 6 }, (_, i) => ({ id: String(i), x: 400 + i * 1700, y: 0,
      width: i % 2 ? 1300 : 1600, height: i % 2 ? 500 : 700 }));
    const input = { id: 'source', x: 0, y: 0, width: 184, height: 800, boundary: 'input' as const };
    const output = { ...input, id: 'output', x: 11000, boundary: 'output' as const };
    const result = compactFlowColumns([input, ...blocks, output], new Set(['source']));
    expect(result[0]).toEqual(input);
    expect(result.at(-1)!.x).toBe(Math.max(...result.slice(1, -1).map(block => block.x + block.width)) + 100);
    const width = Math.max(...result.map(block => block.x + block.width));
    const height = Math.max(...result.map(block => block.y + block.height));
    expect(width / height).toBeGreaterThan(0.5);
    expect(width / height).toBeLessThan(2);
    for (const [i, a] of result.entries()) for (const b of result.slice(i + 1))
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  });
});
