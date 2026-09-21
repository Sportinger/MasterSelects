import { describe, expect, it } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { reconcileCanvasPlacement } from '../../src/components/panels/nodes/canvas/nodeCanvasPlacement';
import { nodeGroupBounds } from '../../src/components/panels/nodes/canvas/groupBounds';
import { createNodeGroupFoldSequence, nodeGroupFoldSteps } from '../../src/components/panels/nodes/canvas/nodeGroupFoldSequence';
import type { NodeLayoutSnapshot } from '../../src/components/panels/nodes/canvas/nodeLayoutTransition';

function setup() {
  const clip = createMockClip({ effects: [{ id: 'k', name: 'Kaleidoscope', type: 'kaleidoscope', enabled: true, params: { segments: 6, rotation: 0 } }] });
  const full = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [], [], undefined, true);
  const project = (states: Record<string, boolean>) => {
    const current = { ...clip, nodeGraph: { version: 1 as const, nodes: [], groups: Object.fromEntries(Object.entries(states).map(([id, collapsed]) => [id, { collapsed }])) } };
    return buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
  };
  const compact = project(Object.fromEntries(full.groups!.map(group => [group.id, true])));
  const expanded = project(Object.fromEntries(full.groups!.map(group => [group.id, false])));
  const initial = reconcileCanvasPlacement(compact), final = reconcileCanvasPlacement(expanded, initial);
  const before = { graph: compact, nodes: compact.nodes.map(node => ({ ...node, layout: initial.nodes[node.id] })) };
  const after = { graph: expanded, nodes: expanded.nodes.map(node => ({ ...node, layout: final.nodes[node.id] })) };
  return { clip, project, before, after, initial, final };
}
const outputX = (snapshot: NodeLayoutSnapshot) => snapshot.nodes.find(node => node.binding?.kind === 'clip-output')!.layout.x;
const groupWidth = (snapshot: NodeLayoutSnapshot) => { const box = nodeGroupBounds(snapshot.graph, snapshot.nodes).get('effect:k')!; return box.right - box.left; };

describe('progressive node group folding', () => {
  it('opens actual intermediate hierarchies left to right and grows their frames and the outer chain at each step', () => {
    const { before, after, initial, project, clip } = setup(), saved = JSON.stringify(clip);
    const steps = nodeGroupFoldSteps(before, after, initial, project);
    const labels = new Map(after.graph.groups!.map(group => [group.id, group.label]));
    expect(steps.map(step => labels.get(step.groupId))).toEqual(['Kaleidoscope', 'Cartesian to Polar', 'Mirror Repeat', 'Polar to Cartesian']);
    expect(steps.map(step => step.at)).toEqual([0, 140, 240, 340]);
    expect(steps.map(step => step.snapshot.graph.groups!.filter(group => !group.collapsed).length)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < steps.length; i++) {
      expect(groupWidth(steps[i].snapshot)).toBeGreaterThan(groupWidth(steps[i - 1].snapshot));
      expect(outputX(steps[i].snapshot)).toBeGreaterThan(outputX(steps[i - 1].snapshot));
    }
    expect(JSON.stringify(clip)).toBe(saved);
  });

  it('closes the same sequence in reverse and shrinks the layout at each step', () => {
    const { before, after, initial, final, project } = setup();
    const opening = nodeGroupFoldSteps(before, after, initial, project);
    const closing = nodeGroupFoldSteps(after, before, final, project);
    expect(closing.map(step => step.groupId)).toEqual(opening.map(step => step.groupId).reverse());
    expect(closing.map(step => step.at)).toEqual([0, 100, 200, 340]);
    expect(closing.map(step => step.snapshot.graph.groups!.filter(group => !group.collapsed).length)).toEqual([3, 2, 1, 0]);
    for (let i = 1; i < closing.length; i++) {
      expect(groupWidth(closing[i].snapshot)).toBeLessThan(groupWidth(closing[i - 1].snapshot));
      expect(outputX(closing[i].snapshot)).toBeLessThan(outputX(closing[i - 1].snapshot));
    }
  });

  it('uses current final positions for peers and continues overlapping transitions from their displayed positions', () => {
    const { before, after, initial, final, project } = setup();
    const opening = createNodeGroupFoldSequence(before, after, initial, project);
    expect(opening.duration).toBe(560);
    const early = opening.sample(80 / opening.duration);
    expect(early.graph.groups!.filter(group => !group.collapsed)).toHaveLength(1);
    expect(outputX(early)).toBeGreaterThan(outputX(before)); expect(outputX(early)).toBeLessThan(outputX(after));
    const middle = opening.sample(280 / opening.duration);
    const closing = createNodeGroupFoldSequence(middle, before, final, project);
    expect(outputX(closing.sample(0))).toBe(outputX(middle));
    expect(closing.sample(1)).toBe(before); expect(opening.sample(1)).toBe(after);
    const cartesian = after.graph.groups!.find(group => group.label === 'Cartesian to Polar')!;
    const moved = { ...after, nodes: after.nodes.map(node => cartesian.nodeIds.includes(node.id) ? { ...node, layout: { x: 10000, y: node.layout.y } } : node) };
    const steps = nodeGroupFoldSteps(before, moved, initial, project);
    expect(steps.at(-1)!.groupId).toBe(cartesian.id);
  });
});
