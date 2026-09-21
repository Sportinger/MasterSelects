import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument, createClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { useUnifiedNodeActions } from '../../src/components/panels/nodes/useUnifiedNodeActions';
import type { FlockGraphActions } from '../../src/components/panels/nodes/flock/useFlockGraphActions';
import { useTimelineStore } from '../../src/stores/timeline';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { groupOperators } from '../../src/services/operators/operatorGroups';

afterEach(() => { cleanup(); useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }); });

function setup() {
  const operatorGraph = createDefaultUvDistortGraph('kaleidoscope');
  const wrapper = groupOperators(operatorGraph, ['sample'], [], 'Hidden sampling');
  const clip = createMockClip({ id: 'clip', effects: [{ id: 'k', type: 'kaleidoscope', name: 'Kaleidoscope', enabled: true,
    params: { segments: 6, rotation: 0 }, operatorGraph }] });
  clip.nodeGraph = { ...createClipNodeGraphState(clip), groups: {
    'effect:k': { collapsed: true, position: { x: 123, y: 456 } },
    [`effect:k/${wrapper}`]: { collapsed: true },
  } };
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], isExporting: false });
  const project = () => {
    const current = useTimelineStore.getState().clips[0];
    return buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
  };
  return { clip, project, graph: project() };
}

describe('fold every node group', () => {
  it('discovers hidden descendants, preserves processing and positions, and reads fresh state across repeated actions', () => {
    const { clip, graph, project } = setup();
    expect(graph.groups).toHaveLength(1);
    const { result } = renderHook(() => useUnifiedNodeActions(clip, graph, null, {} as FlockGraphActions));
    for (const collapsed of [false, true, false]) {
      act(() => result.current.setAllGroupsCollapsed(collapsed));
      const current = useTimelineStore.getState().clips[0];
      expect(result.current.message).toBe('');
      const all = Object.values(current.nodeGraph!.groups!);
      expect(all.length).toBeGreaterThanOrEqual(5);
      expect(all.every(group => group.collapsed === collapsed)).toBe(true);
      expect(current.nodeGraph!.groups!['effect:k'].position).toEqual({ x: 123, y: 456 });
      expect(current.effects).toEqual(clip.effects);
      expect(project().groups).toHaveLength(collapsed ? 1 : all.length);
    }
  });

  it.each(['locked', 'exporting'])('refuses a complete fold while %s', reason => {
    const { clip, graph } = setup();
    useTimelineStore.setState(reason === 'locked'
      ? { tracks: [createMockTrack({ id: clip.trackId, locked: true })] } : { isExporting: true });
    const { result } = renderHook(() => useUnifiedNodeActions(clip, graph, null, {} as FlockGraphActions));
    act(() => result.current.setAllGroupsCollapsed(false));
    expect(useTimelineStore.getState().clips[0].nodeGraph).toEqual(clip.nodeGraph);
    expect(result.current.message).toContain('locked or exporting');
  });
});
