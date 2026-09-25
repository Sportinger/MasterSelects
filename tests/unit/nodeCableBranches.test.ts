import { describe, expect, it } from 'vitest';
import { addBranchTarget, branchCableId, insertCableBranch, removeCableBranches, resolveCableBranches, routeCables } from '../../src/components/panels/nodes/canvas/cableBranches';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { NodeGraphEdge, NodeGraphNode } from '../../src/types/nodeGraph';

const source: NodeGraphNode = { ...connectionFixture.nodes[0], id: 'src', layout: { x: 0, y: 0 },
  outputs: [{ id: 'out', label: 'Out', direction: 'output', type: 'number' }], inputs: [] };
const sink = (id: string, y: number): NodeGraphNode => ({ ...connectionFixture.nodes[0], id, layout: { x: 800, y },
  inputs: [{ id: 'in', label: 'In', direction: 'input', type: 'number' }], outputs: [] });
const nodes = new Map([source, sink('a', 0), sink('b', 300), sink('c', 600)].map(node => [node.id, node]));
const edge = (to: string): NodeGraphEdge => ({ id: `e-${to}`, fromNodeId: 'src', fromPortId: 'out', toNodeId: to, toPortId: 'in', type: 'data' } as NodeGraphEdge);
const edges = ['a', 'b', 'c'].map(edge);
const route = (branches: Parameters<typeof resolveCableBranches>[1]) => {
  const resolved = resolveCableBranches(edges, branches);
  const plugs = getConnectionPlugs(edges, nodes, resolved.edgeRoot);
  return { resolved, plugs, cables: routeCables(plugs, resolved) };
};

describe('presentation-only cable branch points', () => {
  it('routes a branch through one trunk and one shared output grip', () => {
    const plain = route({});
    const bSplit = insertCableBranch({}, plain.cables.find(cable => cable.id === 'e-b')!, { x: 400, y: 200 }, 'p');
    const both = addBranchTarget(bSplit, 'p', { nodeId: 'c', portId: 'in' });
    const { cables, plugs } = route(both);
    expect(cables.find(cable => cable.id === 'e-b')).toMatchObject({ from: { x: 400, y: 200 }, fromBranch: 'p' });
    expect(cables.find(cable => cable.id === 'e-c')).toMatchObject({ from: { x: 400, y: 200 }, fromBranch: 'p' });
    expect(cables.find(cable => cable.id === 'e-a')!.fromBranch).toBeUndefined();
    const trunk = cables.find(cable => cable.id === branchCableId('p'))!;
    expect(trunk).toMatchObject({ to: { x: 400, y: 200 }, fromNode: 'src', toBranch: 'p' });
    const grips = plugs.filter(plug => plug.port.direction === 'output');
    expect(grips.find(plug => plug.edge.id === 'e-b')!.tip).toEqual(grips.find(plug => plug.edge.id === 'e-c')!.tip);
    expect(grips.find(plug => plug.edge.id === 'e-a')!.tip).not.toEqual(grips.find(plug => plug.edge.id === 'e-b')!.tip);
  });

  it('chains points, reroutes on removal and ignores points whose connection is gone', () => {
    const first = insertCableBranch({}, route({}).cables.find(cable => cable.id === 'e-c')!, { x: 300, y: 300 }, 'p');
    const chained = insertCableBranch(first, route(first).cables.find(cable => cable.id === 'e-c')!, { x: 600, y: 500 }, 'q');
    expect(chained.q).toMatchObject({ parentId: 'p', targets: [{ nodeId: 'c', portId: 'in' }] });
    expect(chained.p.targets).toEqual([]);
    const trunkQ = route(chained).cables.find(cable => cable.id === branchCableId('q'))!;
    expect(trunkQ).toMatchObject({ from: { x: 300, y: 300 }, fromBranch: 'p', to: { x: 600, y: 500 } });
    const removed = removeCableBranches(chained, new Set(['p']));
    expect(removed.q.parentId).toBeUndefined();
    expect(route(removed).cables.find(cable => cable.id === branchCableId('q'))).toMatchObject({ fromNode: 'src' });
    expect(route(removeCableBranches(removed, new Set(['q']))).cables.every(cable => !cable.fromBranch)).toBe(true);
    const orphaned = { ...chained, q: { ...chained.q, targets: [{ nodeId: 'deleted', portId: 'in' }] } };
    expect(route(orphaned).resolved.live.size).toBe(0);
  });

  it('inserts a point into a trunk before the existing point', () => {
    const first = insertCableBranch({}, route({}).cables.find(cable => cable.id === 'e-a')!, { x: 500, y: 0 }, 'p');
    const inserted = insertCableBranch(first, route(first).cables.find(cable => cable.id === branchCableId('p'))!, { x: 250, y: -80 }, 'r');
    expect(inserted.p.parentId).toBe('r');
    expect(route(inserted).cables.find(cable => cable.id === branchCableId('p'))).toMatchObject({ from: { x: 250, y: -80 }, fromBranch: 'r' });
  });
});
