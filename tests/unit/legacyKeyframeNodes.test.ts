import { beforeEach, describe, expect, it } from 'vitest';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { withLegacyKeyframeNodes } from '../../src/services/nodeGraph/legacyKeyframeNodes';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { changeKeyframeNode, connectKeyframeNode, removeKeyframeNode } from '../../src/services/nodeGraph/keyframeNodeActions';
import { useTimelineStore } from '../../src/stores/timeline';
import { handleGetKeyframes } from '../../src/services/aiTools/handlers/keyframes';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableProperty } from '../../src/services/faceCables/cableAnimation';

const initial = useTimelineStore.getState();
const state = () => useTimelineStore.getState();
const current = () => state().clips[0];
const keys = () => state().clipKeyframes.get('legacy')!;
const resolved = () => withLegacyKeyframeNodes(current(), keys());
beforeEach(() => {
  useTimelineStore.setState({ ...initial, isExporting: false,
    clips: [createMockClip({ id: 'legacy', source: { type: 'video' } as ReturnType<typeof createMockClip>['source'] })],
    tracks: [createMockTrack({ id: 'video-1' })],
    clipKeyframes: new Map([['legacy', [
      createMockKeyframe({ id: 'first', clipId: 'legacy', property: 'scale.x', time: 0, value: 1, hold: true }),
      createMockKeyframe({ id: 'last', clipId: 'legacy', property: 'scale.x', time: 5, value: 3, handleIn: { x: -1, y: 0.5 } }),
    ]]]),
  });
});

describe('existing project keyframe nodes', () => {
  it('shows existing animation wired to Transform without mutating clips or keys', () => {
    const clip = current(), before = structuredClone(keys());
    const projected = resolved();
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(projected), projected);
    expect(graph.nodes.some(n => n.binding?.kind === 'keyframe-node')).toBe(false);
    expect(graph.nodes.find(n => n.id === 'transform')?.animation?.channels).toMatchObject([{ property: 'scale.x' }]);
    expect(graph.edges.some(edge => edge.id.startsWith('animation:'))).toBe(false);
    expect(current()).toBe(clip);
    expect(clip.nodeGraph).toBeUndefined();
    expect(keys()).toEqual(before);
  });

  it('uses stable node and channel identities when keyframe order or times change', () => {
    const before = resolved().nodeGraph!.keyframeNodes!;
    const after = withLegacyKeyframeNodes(current(), keys().toReversed().map(key => ({ ...key, time: key.time + 2 })));
    expect(after.nodeGraph!.keyframeNodes).toEqual(before);
  });

  it('keeps unrelated animated parameters independent', () => {
    state().addKeyframe('legacy', 'scale.y', 8, 0);
    const node = resolved().nodeGraph!.keyframeNodes![0];
    expect(node.channels.map(channel => channel.property)).toEqual(['scale.x', 'scale.y']);
    expect(node.channels.every(channel => channel.targets.length === 0)).toBe(true);
    state().updateKeyframe('first', { value: 2 });
    expect(keys().find(key => key.property === 'scale.y')!.value).toBe(8);
  });

  it('shows legacy cable slack animation connected to cable simulation', () => {
    const cable = defaultFaceCable();
    const property = cableProperty('cables', cable.id, 'slack');
    const clip = { ...current(), effects: [{ id: 'cables', type: 'face-cables', name: 'Face Cables', enabled: true,
      params: { settings: JSON.stringify([cable]) } }] };
    const projected = withLegacyKeyframeNodes(clip, [createMockKeyframe({ clipId: clip.id, property, value: 1.6 })]);
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(projected), projected, [projected], [], undefined, true);
    const node = graph.nodes.find(n => n.animation?.channels.some(channel => channel.property === property))!;
    expect(node.binding).toMatchObject({ kind: 'effect-operator', operator: 'simulation.rope' });
    expect(node.inputs.some(port => port.metadata?.animationProperty)).toBe(false);
  });

  it('preserves existing graph layout and bindings, exposing unbound animation inline', () => {
    const graph = { version: 1 as const, nodes: [], groups: { flock: { collapsed: true } } };
    const projected = withLegacyKeyframeNodes({ ...current(), nodeGraph: graph }, keys());
    expect(projected.nodeGraph!.groups).toBe(graph.groups);
    const removed = { ...current(), nodeGraph: { ...graph, keyframeNodes: [] } };
    expect(withLegacyKeyframeNodes(removed, keys()).nodeGraph!.keyframeNodes).toHaveLength(1);
    expect(withLegacyKeyframeNodes(projected, keys())).toBe(projected);
    expect(withLegacyKeyframeNodes(current(), [])).toBe(current());
  });

  it('persists an automatic node on first edit and allows linking another parameter', () => {
    const node = resolved().nodeGraph!.keyframeNodes![0];
    const before = keys();
    changeKeyframeNode('legacy', node.id, { label: 'Existing scale', layout: { x: 500, y: -250 } });
    expect(keys()).toBe(before);
    connectKeyframeNode('legacy', node.id, 'scale.y', node.channels[0].id);
    state().updateKeyframe('last', { value: 4 });
    expect(keys().find(key => key.property === 'scale.y' && key.time === 5)).toMatchObject({ value: 4, handleIn: { x: -1, y: 0.5 } });
  });

  it('reattaches removed nodes to their parameter without erasing animation, including history restoration', () => {
    const snapshot = createHistorySnapshot('Legacy animation', { getTimelineState: state });
    const node = resolved().nodeGraph!.keyframeNodes![0], before = keys();
    removeKeyframeNode('legacy', node.id);
    expect(current().nodeGraph!.keyframeNodes).toEqual([]);
    const projected = resolved();
    expect(buildUnifiedClipGraph(buildClipNodeGraphDocument(projected), projected).nodes.some(n => n.binding?.kind === 'keyframe-node')).toBe(false);
    expect(keys()).toBe(before);
    applyHistorySnapshot(snapshot, { getTimelineState: state, setTimelineState: patch => useTimelineStore.setState(patch as Partial<ReturnType<typeof state>>) });
    expect(resolved().nodeGraph!.keyframeNodes![0].id).toBe(node.id);
  });

  it('exposes all automatic channels to AI even when keys are filtered by property', async () => {
    state().addKeyframe('legacy', 'opacity', 0.5, 0);
    const response = await handleGetKeyframes({ clipId: 'legacy', property: 'scale.x' }, state());
    expect(response).toMatchObject({ success: true, data: {
      animationNodes: [{ channels: [{ property: 'opacity', targets: [] }, { property: 'scale.x', targets: [] }] }],
      keyframes: [{ id: 'first' }, { id: 'last' }],
    } });
  });

  it('reconstructs nodes after old-format project save/load with all curve data intact', () => {
    const project = convertCompositions([{
      id: 'comp', name: 'Old project', type: 'composition', parentId: null, createdAt: 0,
      width: 1920, height: 1080, duration: 60, frameRate: 30, backgroundColor: '#000000', timelineData: state().getSerializableState(),
    }]);
    const [restored] = convertProjectCompositionToStore(JSON.parse(JSON.stringify(project)));
    const savedClip = restored.timelineData!.clips[0];
    expect(savedClip.nodeGraph).toBeUndefined();
    expect(savedClip.keyframes!.find(key => key.id === 'first')).toMatchObject({ hold: true });
    expect(savedClip.keyframes!.find(key => key.id === 'last')).toMatchObject({ handleIn: { x: -1, y: 0.5 } });
    // Hydration stores serialized keys on clips before restoring the timeline map.
    const hydrated = { ...current(), nodeGraph: savedClip.nodeGraph };
    expect(withLegacyKeyframeNodes(hydrated, savedClip.keyframes!).nodeGraph!.keyframeNodes).toEqual(resolved().nodeGraph!.keyframeNodes);
  });
});
