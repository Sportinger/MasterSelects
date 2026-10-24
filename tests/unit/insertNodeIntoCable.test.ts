import { afterEach, describe, expect, it } from 'vitest';
import { createEffectGraphActions } from '../../src/services/operators/effectGraphEditing';
import { insertNodeIntoCable } from '../../src/components/panels/nodes/unified/insertNodeIntoCable';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// Inserting into a cable used to connect through the rendered workspace graph, which did not hold
// the new node yet: both sides were skipped silently and the original cable was removed anyway.
afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }));

type Edge = { id: string; from: string; output: string; to: string; input: string };
const graphEdges = () => (useTimelineStore.getState().clips[0].effects[0] as unknown as { operatorGraph: { edges: Edge[] } }).operatorGraph.edges;
const edges = () => graphEdges().map(edge => `${edge.from}.${edge.output}->${edge.to}.${edge.input}`);

function setup() {
  const clip = createMockClip({ id: 'clip', effects: [{ id: 'w', type: 'weave', name: 'Weave', enabled: true, params: {} }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const actions = createEffectGraphActions('clip', 'w');
  const sphere = actions.addNode('geometry.knit-sphere', { x: 0, y: 0 }, undefined, { free: true });
  actions.connectPorts({ fromNodeId: sphere, fromPortId: 'curves', toNodeId: 'render', toPortId: 'curves' });
  return sphere;
}

describe('inserting a node into a cable of an effect graph', () => {
  it('wires the new node to both ends and replaces the original cable', () => {
    const sphere = setup();
    const cable = edges().find(edge => edge === `${sphere}.curves->render.curves`);
    expect(cable).toBeDefined();
    const original = graphEdges().find(edge => edge.from === sphere && edge.to === 'render')!;
    const { nodeId, wired } = insertNodeIntoCable('clip', 'w', {
      id: `clip:clip::effect-w/${original.id}`, type: 'curves', fromNodeId: `x/${sphere}`, fromPortId: 'curves',
      toNodeId: 'x/render', toPortId: 'curves', fromLocalId: sphere, toLocalId: 'render',
    }, 'geometry.yarn-profile', { x: 100, y: 0 });
    const yarn = nodeId.split('/').at(-1);
    expect(wired).toBe(2);
    expect(edges()).toEqual(expect.arrayContaining([`${sphere}.curves->${yarn}.curves`, `${yarn}.curves->render.curves`]));
    expect(edges()).not.toContain(`${sphere}.curves->render.curves`);
  });
});
