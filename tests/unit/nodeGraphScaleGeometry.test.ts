import { describe, expect, it } from 'vitest';
import type { NodeCableBranch, NodeGraph, NodeGraphEdge, NodeGraphNode, NodeGraphPort } from '../../src/types/nodeGraph';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { createOcclusionRectIndex } from '../../src/components/panels/nodes/canvas/occlusionRectIndex';
import { resolveCableBranches } from '../../src/components/panels/nodes/canvas/cableBranches';
import { createCanvasCableOcclusion, canvasCableOcclusions } from '../../src/components/panels/nodes/canvas/rendering/cableOcclusion';
import { shareProjectedGraph } from '../../src/services/nodeGraph/unified/shareProjectedGraph';
import { connectionFixture } from '../helpers/nodeConnectionFixture';

describe('composition-root geometry scales with projected data', () => {
  const portReads = (count: number) => {
    let reads = 0;
    const source: NodeGraphNode = { ...connectionFixture.nodes[0], id: 'media', inputs: [],
      outputs: Array.from({ length: count }, (_, i): NodeGraphPort => ({
        get id() { reads++; return `piece:${i}`; }, label: 'Piece', direction: 'output', type: 'clip',
      })) };
    const nodes = new Map([[source.id, source]]);
    const edges = Array.from({ length: count }, (_, i): NodeGraphEdge => {
      const id = `clip:${i}`;
      nodes.set(id, { ...connectionFixture.nodes[1], id });
      return { id, fromNodeId: source.id, fromPortId: `piece:${i}`, toNodeId: id, toPortId: 'in', type: 'clip' };
    });
    expect(getConnectionPlugs(edges, nodes)).toHaveLength(count * 2);
    return reads;
  };

  it('indexes a high fan-out Media port list once, instead of scanning it per cable', () => {
    const small = portReads(300), large = portReads(1000);
    expect(large).toBeLessThanOrEqual(small * 3.5);
    expect(large).toBeLessThanOrEqual(4000);
  });

  const queryVisits = (count: number) => {
    const query = createOcclusionRectIndex(Array.from({ length: count }, (_, value) => ({
      rect: { x: (value % 10) * 300, y: Math.floor(value / 10) * 200, width: 184, height: 150 }, value,
    })));
    const counters = { visits: 0 };
    for (let i = 0; i < count; i++) expect(query({ x: (i % 10) * 300 + 50,
      y: Math.floor(i / 10) * 200 + 50, width: 1, height: 1 }, counters)).toEqual([i]);
    return counters.visits;
  };

  it('queries local covers in linear-ish total work at 300 and 1000 cards', () => {
    const small = queryVisits(300), large = queryVisits(1000);
    expect(large).toBeLessThan(small * 5);
    expect(large).toBeLessThan(1000 * 80);
  });

  it('indexes branch targets once instead of scanning every target for every edge', () => {
    const readsFor = (count: number) => {
      let reads = 0;
      const branches: Record<string, NodeCableBranch> = { root: { nodeId: 'media', portId: 'out', x: 0, y: 0,
        targets: Array.from({ length: count }, (_, i) => ({ get nodeId() { reads++; return `clip:${i}`; }, portId: 'in' })) } };
      const edges = Array.from({ length: count }, (_, i) => ({ ...connectionFixture.edges[0], id: `${i}`,
        fromNodeId: 'media', toNodeId: `clip:${i}` }));
      expect(resolveCableBranches(edges, branches).edgeRoot.size).toBe(count);
      return reads;
    };
    expect(readsFor(1000)).toBeLessThanOrEqual(readsFor(300) * 3.5);
  });

  it('shares the cover pool, excludes endpoint groups, and queries new positions during drag', () => {
    const graph: NodeGraph = { ...connectionFixture, groups: [
      { id: 'own', label: 'Own', color: '#fff', proxyId: 'Source', nodeIds: ['Source'], collapsed: true },
      { id: 'far', label: 'Far', color: '#fff', proxyId: 'Far', nodeIds: ['Far'], collapsed: true },
    ] };
    const pool = createCanvasCableOcclusion(graph, new Map([
      ['own', { left: 40, top: 0, right: 120, bottom: 80 }],
      ['far', { left: 40, top: 500, right: 120, bottom: 580 }],
    ]));
    const first = pool(graph.edges[0]), second = pool(graph.edges[1]);
    expect(first.rects).toBe(second.rects);
    expect(first.excluded).toEqual([0]);
    const cable = { from: { x: 0, y: 40 }, to: { x: 200, y: 40 }, color: '#fff', highlighted: false, occlusionPool: first };
    expect(canvasCableOcclusions(cable, 12)).toEqual([]);
    expect(canvasCableOcclusions({ ...cable, from: { x: 0, y: 540 }, to: { x: 200, y: 540 } }, 12)).toEqual([first.rects[1]]);
  });

  it('retains unchanged nodes, ports, edges and groups without hiding content or layout edits', () => {
    const original = structuredClone(connectionFixture);
    const identical = shareProjectedGraph(original, structuredClone(original));
    expect(identical.nodes).toBe(original.nodes);
    expect(identical.edges).toBe(original.edges);
    const changed = structuredClone(original);
    changed.nodes[0].description = 'Moved on the timeline';
    changed.nodes[0].layout.x++;
    const shared = shareProjectedGraph(original, changed);
    expect(shared.nodes[0]).toBe(changed.nodes[0]);
    expect(shared.nodes[1]).toBe(original.nodes[1]);
    expect(shared.nodes[1].inputs).toBe(original.nodes[1].inputs);
    expect(shareProjectedGraph(original, { ...changed, id: 'other-composition' }).nodes).toBe(changed.nodes);
  });
});
