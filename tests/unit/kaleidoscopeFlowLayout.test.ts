import { describe, expect, it } from 'vitest';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { createMockClip } from '../helpers/mockData';
import { reconcileCanvasPlacement, moveCanvasPlacement, arrangeFlowPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { NODE_WIDTH } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import type { NodeGraph, NodeCanvasPlacement } from '../../src/types/nodeGraph';
import { createNodeLayoutTransition } from '../../src/components/panels/nodes/canvas/nodeLayoutTransition';

const fixture = () => createMockClip({ id: 'layout-clip', effects: [{ id: 'k', name: 'Kaleidoscope', type: 'kaleidoscope', enabled: true,
  params: { segments: 6, rotation: 0 }, operatorGraph: createDefaultUvDistortGraph('kaleidoscope') }] });
const project = (clip: ReturnType<typeof fixture>) => buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip);
const position = (graph: NodeGraph, placement: NodeCanvasPlacement) => graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] }));

describe('Kaleidoscope dynamic hierarchy layout', () => {
  it('compacts the entire outer chain despite saved outer anchors and stays stable through repeated complete folds', () => {
    const clip = fixture(), base = project(clip);
    const openStates = Object.fromEntries(base.groups!.map(group => [group.id, { collapsed: false }]));
    clip.nodeGraph = { version: 1, nodes: [], groups: openStates };
    const expanded = project(clip);
    let placement = reconcileCanvasPlacement(expanded);
    const source = expanded.nodes.find(node => node.binding?.kind === 'clip-source')!;
    const output = expanded.nodes.find(node => node.binding?.kind === 'clip-output')!;
    placement = moveCanvasPlacement(placement, [{ nodeId: source.id, layout: { x: -1700, y: 350 } },
      { nodeId: output.id, layout: { x: 12000, y: 50 } }]);
    for (const collapsed of [true, false, true, false]) {
      clip.nodeGraph.groups = { ...openStates, 'effect:k': { collapsed } };
      const graph = project(clip);
      placement = reconcileCanvasPlacement(graph, placement);
      const bounds = nodeGroupBounds(graph, position(graph, placement)).get('effect:k')!;
      expect(bounds.left - placement.nodes[source.id].x - NODE_WIDTH).toBeCloseTo(100);
      expect(placement.nodes[output.id].x - bounds.right).toBeCloseTo(100);
      expect(placement.nodes[source.id]).toEqual({ x: -1700, y: 350 });
      const reread = reconcileCanvasPlacement(graph, placement);
      expect(reread.nodes).toEqual(placement.nodes);
      placement = reread;
    }
  });

  it('explicitly arranges all opened interiors, clearing their manual anchors without changing the graph', () => {
    const clip = fixture(), base = project(clip);
    clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(base.groups!.map(group => [group.id, { collapsed: false }])) };
    const graph = project(clip), initial = reconcileCanvasPlacement(graph), unchanged = JSON.stringify(graph);
    const sample = graph.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.nodeId === 'sample')!;
    const output = graph.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.nodeId === 'output')!;
    const moved = moveCanvasPlacement(initial, [{ nodeId: sample.id, layout: { x: -5000, y: -2000 } },
      { nodeId: output.id, layout: { x: -5500, y: -3000 } }]);
    const arranged = arrangeFlowPlacement(graph, moved);
    expect(arranged.pinned?.[sample.id]).toBeUndefined(); expect(arranged.pinned?.[output.id]).toBeUndefined();
    expect(arranged.nodes[output.id].x).toBeGreaterThan(arranged.nodes[sample.id].x + NODE_WIDTH);
    expect(reconcileCanvasPlacement(graph, arranged).nodes).toEqual(arranged.nodes);
    expect(JSON.stringify(graph)).toBe(unchanged);
  });
  it('animates opening, closing and interrupted transitions from their current positions without mutating placements', () => {
    const clip = fixture(), compact = project(clip), compactPlacement = reconcileCanvasPlacement(compact);
    clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(compact.groups!.map(group => [group.id, { collapsed: false }])) };
    const expanded = project(clip), expandedPlacement = reconcileCanvasPlacement(expanded, compactPlacement);
    const before = { graph: compact, nodes: position(compact, compactPlacement) }, after = { graph: expanded, nodes: position(expanded, expandedPlacement) };
    const saved = JSON.stringify(expandedPlacement), opening = createNodeLayoutTransition(before, after);
    const output = expanded.nodes.find(node => node.binding?.kind === 'clip-output')!.id;
    const x = (snapshot: typeof before) => snapshot.nodes.find(node => node.id === output)!.layout.x;
    expect(opening.changed).toBe(true); expect(x(opening.sample(0))).toBe(x(before));
    expect(x(opening.sample(.5))).toBeGreaterThan(x(before)); expect(x(opening.sample(.5))).toBeLessThan(x(after));
    expect(opening.sample(1)).toBe(after);
    const closing = createNodeLayoutTransition(after, before);
    expect(closing.sample(.5).graph).toBe(expanded); expect(x(closing.sample(.5))).toBeGreaterThan(x(before));
    const interrupted = closing.sample(.4), reopening = createNodeLayoutTransition(interrupted, after);
    expect(x(reopening.sample(0))).toBe(x(interrupted)); expect(reopening.sample(1)).toBe(after);
    expect(closing.sample(1)).toBe(before); expect(JSON.stringify(expandedPlacement)).toBe(saved);
  });
  it('reflows expanded interiors, contracts again, and keeps the clip output just after the complete effect', () => {
    const clip = fixture(), compact = project(clip), compactPlacement = reconcileCanvasPlacement(compact);
    clip.nodeGraph = { version: 1, nodes: [], groups: Object.fromEntries(compact.groups!.map(group => [group.id, { collapsed: false }])) };
    const expanded = project(clip), expandedPlacement = reconcileCanvasPlacement(expanded, compactPlacement);
    const compactBounds = nodeGroupBounds(compact, position(compact, compactPlacement)).get('effect:k')!;
    const expandedBounds = nodeGroupBounds(expanded, position(expanded, expandedPlacement)).get('effect:k')!;
    expect(expandedBounds.right - expandedBounds.left).toBeGreaterThan(compactBounds.right - compactBounds.left);
    const output = expanded.nodes.find(node => node.binding?.kind === 'clip-output')!;
    expect(expandedPlacement.nodes[output.id].x).toBeGreaterThan(expandedBounds.right);
    expect(expandedPlacement.nodes[output.id].x - expandedBounds.right).toBeLessThan(300);
    const restored = reconcileCanvasPlacement(compact, expandedPlacement);
    expect(restored.nodes[output.id]).toEqual(compactPlacement.nodes[output.id]);
  });

  it('includes newly added wiring while preserving explicit user anchors', () => {
    const clip = fixture();
    clip.nodeGraph = { version: 1, nodes: [], groups: { 'effect:k': { collapsed: false } } };
    const before = project(clip), initial = reconcileCanvasPlacement(before);
    const uv = before.nodes.find(node => node.binding?.kind === 'effect-operator' && node.binding.nodeId === 'uv')!;
    const manual = { x: initial.nodes[uv.id].x + 70, y: initial.nodes[uv.id].y + 800 };
    const anchored = moveCanvasPlacement(initial, [{ nodeId: uv.id, layout: manual }]);
    const graph = clip.effects[0].operatorGraph!;
    graph.nodes.push({ id: 'inserted', operator: 'math.add.vec2', operatorVersion: 1, bindings: {} });
    const sample = graph.edges.find(edge => edge.to === 'sample' && edge.input === 'uv')!;
    graph.edges.push({ id: 'new-a', from: sample.from, output: sample.output, to: 'inserted', input: 'a' },
      { id: 'new-b', from: 'uv', output: 'uv', to: 'inserted', input: 'b' });
    sample.from = 'inserted'; sample.output = 'value'; graph.layout.inserted = { x: 0, y: 0 };
    const after = project(clip), placed = reconcileCanvasPlacement(after, anchored);
    expect(placed.nodes[uv.id]).toEqual(manual);
    const bounds = nodeGroupBounds(after, position(after, placed)).get('effect:k')!;
    const output = after.nodes.find(node => node.binding?.kind === 'clip-output')!;
    expect(placed.nodes[output.id].x).toBeGreaterThan(bounds.right);
    expect(after.nodes.some(node => node.binding?.kind === 'effect-operator' && node.binding.nodeId === 'inserted')).toBe(true);
  });
});
