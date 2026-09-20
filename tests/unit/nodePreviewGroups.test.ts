import { describe, expect, it } from 'vitest';
import { spacePreviewGroups } from '../../src/components/panels/nodes/canvas/spacePreviewGroups';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { getNodeHeight, NODE_WIDTH, type NodeBounds } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { foldOperatorGroups } from '../../src/services/nodeGraph/nestedOperatorGroups';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraph } from '../../src/types/nodeGraph';

const fixture: NodeGraph = { ...connectionFixture, edges: [],
  nodes: Array.from({ length: 7 }, (_, i) => ({ ...connectionFixture.nodes[0], id: String(i),
    layout: { x: (i % 3) * 200, y: Math.floor(i / 3) * 220 },
    preview: { enabled: true, requested: true, key: String(i), aspectRatio: 9 / 16 } })),
  groups: [
    { id: 'effect', label: 'Effect', proxyId: 'effect-proxy', nodeIds: ['0', '1', '2', '3'] },
    { id: 'surface', label: 'Surface', proxyId: 'surface-proxy', nodeIds: ['0', '3'], parentId: 'effect' },
    { id: 'physics', label: 'Physics', proxyId: 'physics-proxy', nodeIds: ['1', '2'], parentId: 'effect' },
    { id: 'scene', label: 'Scene', proxyId: 'scene-proxy', nodeIds: ['4', '5'] },
  ],
};
const disjoint = (a: NodeBounds, b: NodeBounds) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

function checkGraph(graph: NodeGraph) {
  const nodes = spacePreviewGroups(graph), bounds = nodeGroupBounds(graph, nodes);
  const ancestors = (id: string): string[] => {
    const parent = graph.groups?.find(group => group.id === id)?.parentId;
    return parent ? [parent, ...ancestors(parent)] : [];
  };
  for (const group of graph.groups ?? []) {
    const box = bounds.get(group.id)!;
    for (const other of graph.groups ?? []) if (other.id !== group.id && !ancestors(group.id).includes(other.id) && !ancestors(other.id).includes(group.id))
      expect(disjoint(box, bounds.get(other.id)!), `${group.id} / ${other.id}`).toBe(true);
    for (const node of nodes) if (!group.nodeIds.includes(node.id))
      expect(disjoint(box, { left: node.layout.x, top: node.layout.y, right: node.layout.x + NODE_WIDTH, bottom: node.layout.y + getNodeHeight(node) }), `${group.id} / ${node.id}`).toBe(true);
  }
  for (const [i, node] of nodes.entries()) for (const other of nodes.slice(i + 1))
    expect(disjoint({ left: node.layout.x, top: node.layout.y, right: node.layout.x + NODE_WIDTH, bottom: node.layout.y + getNodeHeight(node) },
      { left: other.layout.x, top: other.layout.y, right: other.layout.x + NODE_WIDTH, bottom: other.layout.y + getNodeHeight(other) })).toBe(true);
  expect(spacePreviewGroups({ ...graph, nodes })).toEqual(nodes);
  return nodes;
}

describe('preview group placement', () => {
  it('reflows grandchildren and direct sibling cards at three nesting levels', () => {
    const graph = { ...fixture, groups: [...fixture.groups!,
      { id: 'forces', label: 'Forces', proxyId: 'forces-proxy', nodeIds: ['1'], parentId: 'physics' }] };
    for (const collapsed of [false, true, false]) {
      const projected = foldOperatorGroups(graph, { groups: { forces: { collapsed } } });
      projected.nodes = projected.nodes.map(node => ({ ...node, preview: { enabled: true, requested: true, key: node.id, aspectRatio: 9 / 16 } }));
      checkGraph(projected);
    }
  });
  it('keeps expanded frames, sibling groups and unrelated cards apart through repeated folding', () => {
    for (const collapsed of [false, true, false, true, false]) {
      const projected = foldOperatorGroups(fixture, { groups: { physics: { collapsed } } });
      projected.nodes = projected.nodes.map(node => ({ ...node, preview: { enabled: true, requested: true, key: node.id, aspectRatio: 9 / 16 } }));
      checkGraph(projected);
    }
    expect(fixture.nodes[0].layout).toEqual({ x: 0, y: 0 });
  });
  it('moves descendants together when a parent contains only subgroups', () => {
    const graph = { ...fixture, groups: fixture.groups!.map(group => group.id === 'effect' ? { ...group, nodeIds: [] } : group) };
    const nodes = spacePreviewGroups(graph), bounds = nodeGroupBounds(graph, nodes);
    expect(disjoint(bounds.get('effect')!, bounds.get('scene')!)).toBe(true);
    for (const id of ['surface', 'physics']) {
      const parent = bounds.get('effect')!, child = bounds.get(id)!;
      expect(parent.left).toBeLessThan(child.left); expect(parent.top).toBeLessThan(child.top);
      expect(parent.right).toBeGreaterThan(child.right); expect(parent.bottom).toBeGreaterThan(child.bottom);
    }
  });
});
