import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument, createClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { useUnifiedNodeActions } from '../../src/components/panels/nodes/useUnifiedNodeActions';
import type { FlockGraphActions } from '../../src/components/panels/nodes/flock/useFlockGraphActions';
import { useTimelineStore } from '../../src/stores/timeline';

// A marquee over an opened Weave selects its folders (collapsed node groups) next to plain
// nodes; Delete used to drop the nodes and silently keep every folder.
afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });
const flock = {} as FlockGraphActions;

function setup() {
  const clip = createMockClip({ id: 'clip', effects: [{ id: 'w', type: 'weave', name: 'Weave', enabled: true, params: {} }] });
  clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: { 'effect:w': { collapsed: false } } };
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const project = () => {
    const current = useTimelineStore.getState().clips[0];
    return { current, graph: buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current) };
  };
  return project;
}

describe('deleting a selected folder', () => {
  it('removes the folder with its nodes, as Delete Group does', () => {
    const project = setup();
    const { current, graph } = project();
    const folder = graph.nodes.find(node => node.binding?.kind === 'operator-group' && node.label === 'Handmade');
    expect(folder).toBeDefined();
    const { result } = renderHook(() => useUnifiedNodeActions(current, graph, null, flock));
    act(() => result.current.deleteNode(folder!.id));
    expect(result.current.message).toBe('');
    const after = project().graph;
    expect(after.nodes.some(node => node.label === 'Handmade')).toBe(false);
    expect(after.nodes.some(node => node.label === 'Yarn')).toBe(true);
  });
});
