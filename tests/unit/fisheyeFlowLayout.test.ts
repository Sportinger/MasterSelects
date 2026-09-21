import { describe, expect, it } from 'vitest';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { createMockClip } from '../helpers/mockData';
import { reconcileCanvasPlacement, arrangeFlowPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { NODE_WIDTH, getNodeHeight } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';

const fixture = () => createMockClip({ id: 'fisheye-layout', effects: [{ id: 'f', name: 'Fisheye', type: 'fisheye', enabled: true,
  params: {}, operatorGraph: createDefaultFisheyeGraph() }] });
const project = (clip: ReturnType<typeof fixture>, all = false) => buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [], [], undefined, all);

describe('Fisheye dynamic hierarchy layout', () => {
  it('bundles repeated incoming signals in local folders while preserving all editable leaf endpoints', () => {
    const clip = fixture(), all = project(clip, true);
    clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(all.groups!.map(group => [group.id, { collapsed: group.id !== 'effect:f' }])) };
    const compact = project(clip);
    expect(compact.nodes).toHaveLength(10);
    for (const area of all.groups!.filter(group => group.parentId === 'effect:f')) {
      const proxy = compact.nodes.find(node => node.id === area.proxyId)!;
      const ids = new Set(area.nodeIds);
      const incoming = all.edges.filter(edge => ids.has(edge.toNodeId) && !ids.has(edge.fromNodeId));
      const endpoints = proxy.inputs.flatMap(port => port.metadata?.groupEndpoints ?? []);
      expect(endpoints.map(p => `${p.nodeId}:${p.portId}`).toSorted()).toEqual(incoming.map(edge => `${edge.toNodeId}:${edge.toPortId}`).toSorted());
      const links = compact.edges.filter(edge => edge.toNodeId === proxy.id);
      expect(new Set(links.map(edge => `${edge.fromNodeId}:${edge.fromPortId}:${edge.toPortId}`)).size).toBe(links.length);
    }
    const lens = compact.nodes.find(node => node.label === 'Lens Projection')!;
    const lensArea = all.groups!.find(group => group.id.endsWith('/fisheye-lens'))!;
    const lensIncoming = all.edges.filter(edge => lensArea.nodeIds.includes(edge.toNodeId) && !lensArea.nodeIds.includes(edge.fromNodeId));
    expect(lens.inputs.length).toBe(new Set(lensIncoming.map(edge => `${edge.fromNodeId}:${edge.fromPortId}`)).size);
    expect(lens.inputs.length).toBeLessThan(lensIncoming.length);
    const parameters = compact.nodes.find(node => node.label === 'Fisheye Parameters')!;
    expect(parameters.outputs.some(port => port.label.includes('squeeze'))).toBe(true);
    expect(compact.edges.length).toBeLessThan(90);
  });
  it('reuses immutable effect interiors across staged folds and produces the same projection', () => {
    const clip = fixture(), document = buildClipNodeGraphDocument(clip);
    const inner = buildEffectOperatorGraph(clip, clip.effects[0]), saved = JSON.stringify(inner), prepared = new Map([['f', inner]]);
    const all = project(clip, true);
    for (const closed of [true, false]) {
      clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(all.groups!.map(group => [group.id, { collapsed: closed }])) };
      const cached = buildUnifiedClipGraph(document, clip, [], [], undefined, false, prepared);
      expect(cached).toEqual(buildUnifiedClipGraph(document, clip));
      expect(JSON.stringify(inner)).toBe(saved);
    }
  });
  it('arranges every expanded level without overlapping sibling frames or cards, then contracts the outer chain', () => {
    const clip = fixture(), all = project(clip, true);
    expect(all.groups).toHaveLength(27);
    clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(all.groups!.map(group => [group.id, { collapsed: false }])) };
    const expanded = project(clip), placement = arrangeFlowPlacement(expanded, reconcileCanvasPlacement(expanded));
    const nodes = expanded.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] }));
    const bounds = nodeGroupBounds(expanded, nodes);
    for (const parent of expanded.groups!) {
      const children = expanded.groups!.filter(group => group.parentId === parent.id);
      const childIds = new Set(children.flatMap(group => group.nodeIds));
      const boxes = [ ...children.map(group => ({ id: group.id, ...bounds.get(group.id)! })),
        ...nodes.filter(node => parent.nodeIds.includes(node.id) && !childIds.has(node.id)).map(node => ({ id: node.id,
          left: node.layout.x, top: node.layout.y, right: node.layout.x + NODE_WIDTH, bottom: node.layout.y + getNodeHeight(node) })) ];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
    const reread = reconcileCanvasPlacement(expanded, placement);
    for (const [id, point] of Object.entries(placement.nodes)) {
      expect(reread.nodes[id].x).toBeCloseTo(point.x, 7); expect(reread.nodes[id].y).toBeCloseTo(point.y, 7);
    }
    const parameters = expanded.groups!.find(group => group.id.endsWith('/fisheye-parameters'))!;
    const values = nodes.filter(node => parameters.nodeIds.includes(node.id) && node.operatorId === 'values.number');
    expect(new Set(values.map(node => node.layout.x)).size).toBeGreaterThan(2);
    const output = expanded.nodes.find(node => node.binding?.kind === 'clip-output')!.id;
    expect(placement.nodes[output].x - bounds.get('effect:f')!.right).toBeCloseTo(100);
    clip.nodeGraph.groups = Object.fromEntries(all.groups!.map(group => [group.id, { collapsed: true }]));
    const compact = project(clip), compactPlacement = reconcileCanvasPlacement(compact, placement);
    expect(compact.nodes).toHaveLength(3);
    expect(compactPlacement.nodes[output].x).toBeLessThan(placement.nodes[output].x);
    const compactBounds = nodeGroupBounds(compact, compact.nodes.map(node => ({ ...node, layout: compactPlacement.nodes[node.id] })));
    expect(compactPlacement.nodes[output].x - compactBounds.get('effect:f')!.right).toBeCloseTo(100);
  });
});
