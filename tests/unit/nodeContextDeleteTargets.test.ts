import { describe, expect, it } from 'vitest';
import { resolveNodeContextDeleteTargets } from '../../src/components/panels/nodes/workspace/nodeContextDeleteTargets';
import type { NodeGraph } from '../../src/types/nodeGraph';
import type { TimelineClip } from '../../src/types/timeline';

const clip = { effects: [{ id: 'fx1', name: 'Particles' }] } as unknown as TimelineClip;
const graph = {
  nodes: [],
  groups: [
    { id: 'effect-fx1', label: 'Particles', color: '#fff', collapsed: false, nodeIds: [], proxyId: 'p1', effectId: 'fx1' },
    { id: 'effect-fx1/resolution', label: 'Resolution', color: '#fff', collapsed: false, nodeIds: [], proxyId: 'p2', parentId: 'effect-fx1' },
  ],
} as unknown as NodeGraph;

describe('node context delete targets', () => {
  it('offers group and effect deletes for a right-clicked nested group frame', () => {
    expect(resolveNodeContextDeleteTargets(clip, graph, null, 'effect-fx1/resolution')).toEqual({
      effect: { effectId: 'fx1', label: 'Particles' },
      group: { effectId: 'fx1', groupId: 'resolution', label: 'Resolution' },
    });
  });

  it('offers only the effect delete for an effect frame and nothing for empty canvas', () => {
    expect(resolveNodeContextDeleteTargets(clip, graph, null, 'effect-fx1')).toEqual({ effect: { effectId: 'fx1', label: 'Particles' } });
    expect(resolveNodeContextDeleteTargets(clip, graph, null, null)).toEqual({});
  });
});
