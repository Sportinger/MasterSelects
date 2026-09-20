import { describe, expect, it } from 'vitest';
import { nodeGroupDropTarget } from '../../src/components/panels/nodes/canvas/nodeGroupDrop';
import { reconcileCanvasPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { placeTransferredNodes } from '../../src/components/panels/nodes/canvas/placeTransferredNodes';
import { getNodeHeight, NODE_WIDTH } from '../../src/components/panels/nodes/canvas/canvasGeometry';

const graph = { ...connectionFixture, nodes: connectionFixture.nodes.slice(0, 2).map((node, i) => ({ ...node, layout: { x: i * 600, y: 100 } })), groups: [
  { id: 'from', label: 'Source', proxyId: 'proxy-from', color: '#aaa', collapsed: false, nodeIds: [connectionFixture.nodes[0].id] },
  { id: 'to', label: 'Target', proxyId: 'proxy-to', color: '#bbb', collapsed: false, nodeIds: [connectionFixture.nodes[1].id] },
] };
const ids = [graph.nodes[0].id];
describe('unlocked node group drops', () => {
  it('packs incoming cards against full target preview bounds, preserving existing positions', () => {
    const before = structuredClone(graph.nodes), target = graph.nodes[1];
    const placed = placeTransferredNodes(graph, graph.nodes, 'to', [{ nodeId: ids[0], layout: { ...target.layout } }]);
    const position = placed[0].layout;
    expect(position.x >= target.layout.x + NODE_WIDTH || position.y >= target.layout.y + getNodeHeight(target)).toBe(true);
    expect(graph.nodes).toEqual(before);
  });
  it('finds the destination under the release point against the original frame', () => {
    const placement = reconcileCanvasPlacement(graph);
    placement.groups.from.locked = false; placement.groups.to.locked = false;
    expect(nodeGroupDropTarget(graph, graph.nodes, placement, ids, { x: 660, y: 140 })).toBe('to');
    expect(nodeGroupDropTarget(graph, graph.nodes, placement, ids, { x: 60, y: 140 })).toBeUndefined();
  });
  it('requires the source to be unlocked and lets a locked target accept a node', () => {
    const placement = reconcileCanvasPlacement(graph);
    expect(() => nodeGroupDropTarget(graph, graph.nodes, placement, ids, { x: 660, y: 140 })).toThrow('Unlock Source');
    placement.groups.from.locked = false;
    expect(nodeGroupDropTarget(graph, graph.nodes, placement, ids, { x: 660, y: 140 })).toBe('to');
  });
  it('lets an unlocked enclosing effect release nodes from its nested groups', () => {
    const nested = { ...graph, groups: [...graph.groups, { ...graph.groups[0], id: 'child', parentId: 'from', proxyId: 'child-proxy' }] };
    const placement = reconcileCanvasPlacement(nested); placement.groups.from.locked = false;
    expect(nodeGroupDropTarget(nested, nested.nodes, placement, ids, { x: 660, y: 140 })).toBe('to');
  });
});
