import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultVoxelGraph } from '../../src/services/operators/voxelGraph';
import { EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraph';
import { addableEffectOperators } from '../../src/services/operators/effectGraphOwner';
import { createEffectGraphActions } from '../../src/services/operators/effectGraphEditing';
import { addEffectGraphNode } from '../../src/components/panels/nodes/workspace/addEffectGraphNode';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));

function setup() {
  const graph = createDefaultVoxelGraph();
  const clip = createMockClip({ id: 'clip', effects: [{ id: 'relief', name: 'Voxel Relief', type: 'voxel-relief', enabled: true,
    params: { [EFFECT_GRAPH_PARAM]: JSON.stringify(graph) } }] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
  // A node type that already exists with wired inputs, so the default add would copy its wiring.
  const addable = new Set(addableEffectOperators('voxel-relief').map(operator => operator.id));
  const template = graph.nodes.find(node => addable.has(node.operator) && graph.edges.some(edge => edge.to === node.id))!;
  return { template };
}
const current = () => JSON.parse(String(useTimelineStore.getState().clips[0].effects[0].params[EFFECT_GRAPH_PARAM])) as ReturnType<typeof createDefaultVoxelGraph>;

describe('adding nodes from the workspace menu', () => {
  it('places the node unconnected at the menu position', () => {
    const { template } = setup();
    const projected = addEffectGraphNode('clip', 'relief', template.operator, { x: 1234, y: 567 });
    const id = projected.split('/').at(-1)!;
    const graph = current();
    expect(graph.layout[id]).toEqual({ x: 1234, y: 567 });
    expect(graph.edges.filter(edge => edge.from === id || edge.to === id)).toEqual([]);
    expect(graph.groups?.some(group => group.nodeIds.includes(id)) ?? false).toBe(false);
  });

  it('keeps copying template wiring for other callers', () => {
    const { template } = setup();
    const id = createEffectGraphActions('clip', 'relief').addNode(template.operator);
    expect(current().edges.some(edge => edge.to === id)).toBe(true);
  });
});
