import { describe, expect, it } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { nodeGroupBounds, withGroupSize } from '../../src/components/panels/nodes/canvas/groupBounds';
import { buildNodeContextMenuEntries } from '../../src/components/panels/nodes/workspace/nodeContextMenuEntries';
import type { Effect } from '../../src/types';

const graphEffect = (nodes: Array<{ id: string; operator: string }>): Effect => ({
  id: 'fx', type: 'invert', name: 'Effect', enabled: false, detached: true, params: {},
  operatorGraph: { version: 1, schemaVersion: 1, domain: 'image', nodes: nodes.map(node => ({ ...node, operatorVersion: 1, bindings: {} })),
    edges: [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }],
    layout: { frame: { x: 0, y: 0 }, output: { x: 280, y: 0 } } },
} as Effect);
const anchors = [{ id: 'frame', operator: 'image.frame' }, { id: 'output', operator: 'image.output' }];
const project = (effect: Effect) => {
  const clip = createMockClip({ id: 'clip', source: { type: 'video' }, effects: [effect] });
  clip.nodeGraph = { version: 1, nodes: [], groups: { 'effect:fx': { collapsed: false, position: { x: 100, y: 100 }, size: { width: 700, height: 320 } } } };
  return buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined);
};

describe('empty effect space', () => {
  it('keeps a hand-set frame size only while the effect holds just its clip input and output', () => {
    const empty = project(graphEffect(anchors));
    const group = empty.groups!.find(candidate => candidate.id === 'effect:fx')!;
    expect(group).toMatchObject({ resizable: true, size: { width: 700, height: 320 } });
    const box = nodeGroupBounds(empty, empty.nodes).get('effect:fx')!;
    expect([box.right - box.left, box.bottom - box.top]).toEqual([700, 320]);

    const filled = project(graphEffect([...anchors, { id: 'blur', operator: 'math.add.scalar' }]));
    const filledGroup = filled.groups!.find(candidate => candidate.id === 'effect:fx')!;
    expect(filledGroup.resizable).toBeUndefined();
    expect(filledGroup.size).toBeUndefined();
  });

  it('never shrinks a frame below its members', () => {
    expect(withGroupSize({ left: 0, top: 0, right: 500, bottom: 200 }, { width: 300, height: 400 }))
      .toEqual({ left: 0, top: 0, right: 500, bottom: 400 });
  });

  it('offers Empty Effect in the canvas menu', () => {
    let added = 0;
    const entries = buildNodeContextMenuEntries({
      clipStages: { canAddVisual: true, canAddKeyframes: true, onAddAI: () => {}, onAddKeyframes: () => {}, onAddStage: () => {} },
      effects: { groups: [], onAdd: () => {} }, graphs: { owners: [] },
      emptyEffect: { disabled: false, onAdd: () => { added++; } },
    });
    const entry = entries.find(candidate => candidate.id === 'empty-effect');
    expect(entry).toMatchObject({ kind: 'item', label: 'Empty Effect', disabled: false });
    if (entry?.kind === 'item') entry.onSelect();
    expect(added).toBe(1);
  });
});
