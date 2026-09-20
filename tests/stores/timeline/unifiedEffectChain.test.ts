import { describe, expect, it } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip } from '../../helpers/mockData';
import { buildClipNodeGraph, createClipNodeGraphState } from '../../../src/services/nodeGraph';

describe('effect stack / graph store synchronization', () => {
  it('adds, reorders from both surfaces and removes effects while keeping parameters and keyframes', () => {
    const clip = createMockClip({ id: 'clip', source: { type: 'video' } });
    clip.nodeGraph = { ...createClipNodeGraphState(clip), manualEdges: buildClipNodeGraph(clip).edges };
    const store = createTestTimelineStore({ clips: [clip] });
    const a = store.getState().addClipEffect(clip.id, 'brightness');
    const b = store.getState().addClipEffect(clip.id, 'contrast');
    const current = () => store.getState().clips[0];
    const order = () => current().effects.map(e => e.id);
    expect(buildClipNodeGraph(current()).edges).toContainEqual(expect.objectContaining({ fromNodeId: `effect-${a}`, toNodeId: `effect-${b}` }));
    store.getState().updateClipEffect(clip.id, a, { amount: 0.6 });
    store.getState().connectClipNodeGraphPorts(clip.id, { fromNodeId: `effect-${b}`, fromPortId: 'output', toNodeId: `effect-${a}`, toPortId: 'input' });
    expect(order()).toEqual([b, a]);
    expect(current().effects[1].params.amount).toBe(0.6);
    store.getState().reorderClipEffect(clip.id, a, 0);
    expect(order()).toEqual([a, b]);
    expect(buildClipNodeGraph(current()).edges).toContainEqual(expect.objectContaining({ fromNodeId: `effect-${a}`, toNodeId: `effect-${b}` }));
    store.getState().removeClipEffect(clip.id, b);
    expect(buildClipNodeGraph(current()).edges).toContainEqual(expect.objectContaining({ fromNodeId: `effect-${a}`, toNodeId: 'output' }));
  });
});
