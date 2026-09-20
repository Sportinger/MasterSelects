import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { addKeyframeNode, changeKeyframeNode, connectKeyframeNode, disconnectKeyframeNode, removeKeyframeNode } from '../../src/services/nodeGraph/keyframeNodeActions';
import { synchronizeKeyframeNodes } from '../../src/services/nodeGraph/keyframeNodeSynchronization';
import { keyframeNodeParameters, validateKeyframeNodeTarget } from '../../src/services/nodeGraph/keyframeNodeParameters';
import { buildClipNodeGraphDocument, cloneClipNodeGraph, remapClipNodeGraphEffectIds } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { interpolateKeyframes } from '../../src/utils/keyframeInterpolation';
import type { Keyframe } from '../../src/types';
import { calculateSourceTime } from '../../src/utils/speedIntegration';
import { remapKeyframeNodeProperties } from '../../src/services/nodeGraph/keyframeNodeRemapping';
import { generateBezierPath } from '../../src/components/timeline/utils/curveEditorMath';
import { handleGetKeyframes } from '../../src/services/aiTools/handlers/keyframes';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';

const initial = useTimelineStore.getState();
const state = () => useTimelineStore.getState();
const keys = () => state().clipKeyframes.get('clip-a') ?? [];
const clip = () => state().clips[0];
const source = () => keys().filter(k => k.property === 'scale.x');
const target = () => keys().filter(k => k.property === 'scale.y');
function fixture() {
  useTimelineStore.setState({ ...initial,
    clips: [createMockClip({ id: 'clip-a', trackId: 'video-1', duration: 10, startTime: 20,
      nodeGraph: { version: 1, nodes: [], keyframeNodes: [] } })],
    tracks: [createMockTrack({ id: 'video-1', type: 'video' })], playheadPosition: 20,
    clipKeyframes: new Map([['clip-a', [
      createMockKeyframe({ id: 'a', clipId: 'clip-a', property: 'scale.x', time: 0, value: 1 }),
      createMockKeyframe({ id: 'b', clipId: 'clip-a', property: 'scale.x', time: 10, value: 3 }),
    ]]]), isExporting: false,
  });
}
function linked(mapping?: { scale: number; offset: number }) {
  const id = addKeyframeNode('clip-a');
  connectKeyframeNode('clip-a', id, 'scale.x');
  const channel = clip().nodeGraph!.keyframeNodes![0].channels[0];
  connectKeyframeNode('clip-a', id, 'scale.y', channel.id, mapping);
  return id;
}

beforeEach(fixture);
describe('universal keyframe nodes', () => {
  it('adopts an existing timeline curve without changing its keys', () => {
    const before = source();
    const id = addKeyframeNode('clip-a');
    connectKeyframeNode('clip-a', id, 'scale.x');
    expect(source()).toEqual(before);
    expect(keys()).toHaveLength(2);
  });
  it('uses clip-local playhead time when creating the first key', () => {
    state().setPlayheadPosition(24);
    const id = addKeyframeNode('clip-a');
    connectKeyframeNode('clip-a', id, 'opacity');
    expect(keys().find(k => k.property === 'opacity')?.time).toBe(4);
  });
  it('updates linked outputs through ordinary keyframe edits and renderer sampling', () => {
    linked();
    state().updateKeyframe('b', { value: 5 });
    expect(target().map(k => k.value)).toEqual([1, 5]);
    expect(state().getInterpolatedTransform('clip-a', 5).scale.y).toBeCloseTo(state().getInterpolatedTransform('clip-a', 5).scale.x);
  });
  it('writes changes from a linked timeline lane back through an explicit mapping', () => {
    linked({ scale: 2, offset: 10 });
    state().updateKeyframe(target()[1].id, { value: 20, handleIn: { x: -1, y: 4 } });
    expect(source()[1].value).toBe(5);
    expect(source()[1].handleIn).toEqual({ x: -1, y: 2 });
    expect(target()[1].value).toBe(20);
  });
  it('adds and removes keys from either linked lane', () => {
    linked();
    state().addKeyframe('clip-a', 'scale.y', 7, 5);
    expect(source().map(k => k.value)).toEqual([1, 7, 3]);
    state().removeKeyframe(target()[1].id);
    expect(source()).toHaveLength(2);
    expect(target()).toHaveLength(2);
  });
  it('preserves independent animation when a target or node is removed', () => {
    const id = linked();
    disconnectKeyframeNode('clip-a', id, 'scale.y');
    expect(target()).toHaveLength(2);
    expect(target().every(k => !k.animationSource)).toBe(true);
    state().updateKeyframe('b', { value: 9 });
    expect(target()[1].value).toBe(3);
    removeKeyframeNode('clip-a', id);
    expect(source()).toHaveLength(2);
  });
  it('round trips bindings and curves and preserves restored source values', () => {
    linked();
    const saved = JSON.parse(JSON.stringify({ clip: clip(), keys: keys() }));
    state().updateKeyframe('b', { value: 9 });
    useTimelineStore.setState({ clips: [saved.clip], clipKeyframes: new Map([['clip-a', saved.keys]]) });
    expect(source()[1].value).toBe(3);
    expect(target()[1].value).toBe(3);
    expect(cloneClipNodeGraph(clip().nodeGraph)?.keyframeNodes).toEqual(clip().nodeGraph?.keyframeNodes);
  });
  it('does not change keyframe identity for a layout edit or playback tick', () => {
    const id = linked(), before = state().clipKeyframes;
    changeKeyframeNode('clip-a', id, { layout: { x: 80, y: 90 } });
    expect(state().clipKeyframes).toBe(before);
    const patch = { playheadPosition: 25 };
    expect(synchronizeKeyframeNodes(state(), patch)).toBe(patch);
  });
  it('enforces locked tracks, export locks, occupied inputs and time/range compatibility', () => {
    const id = linked();
    expect(() => connectKeyframeNode('clip-a', id, 'scale.y')).toThrow('already belongs');
    const p = keyframeNodeParameters(clip()).find(p => p.property === 'opacity')!;
    expect(() => validateKeyframeNodeTarget(p, { ...p, min: 10 })).toThrow('ranges');
    expect(() => validateKeyframeNodeTarget(p, { ...p, property: 'flock.node.test.value' }, true)).toThrow('time bases');
    useTimelineStore.setState({ isExporting: true });
    expect(() => removeKeyframeNode('clip-a', id)).toThrow('locked');
    useTimelineStore.setState({ isExporting: false, tracks: [createMockTrack({ id: 'video-1', locked: true })] });
    expect(() => addKeyframeNode('clip-a')).toThrow('locked');
  });
  it('projects live bindings as visible animation ports and remaps effect paths on copy', () => {
    const id = linked();
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip()), clip());
    expect(graph.nodes.find(n => n.id === id)?.binding?.kind).toBe('keyframe-node');
    expect(graph.edges.filter(e => e.fromNodeId === id)).toHaveLength(2);
    const model = cloneClipNodeGraph(clip().nodeGraph)!;
    model.keyframeNodes![0].channels[0].property = 'effect.old.amount';
    model.keyframeNodes![0].channels[0].targets[0].property = 'effect.old.other';
    const remapped = remapClipNodeGraphEffectIds(model, new Map([['old', 'new']]))!;
    expect(remapped.keyframeNodes![0].channels[0].property).toBe('effect.new.amount');
    expect(remapped.keyframeNodes![0].channels[0].targets[0].property).toBe('effect.new.other');
  });
  it('holds discrete values until the next keyframe', () => {
    const discrete: Keyframe[] = source().map(k => ({ ...k, hold: true }));
    expect(interpolateKeyframes(discrete, 'scale.x', 9.99, 0)).toBe(1);
    expect(interpolateKeyframes(discrete, 'scale.x', 10, 0)).toBe(3);
    expect(generateBezierPath(discrete[0], discrete[1], t => t, v => v)).toContain('L 10 1');
    expect(calculateSourceTime(discrete.map(k => ({ ...k, property: 'speed' })), 12, 1)).toBeCloseTo(16);
  });
  it('preserves linked target animation when the source owner is deleted', () => {
    const id = linked(), graph = structuredClone(clip().nodeGraph!);
    graph.keyframeNodes![0].channels[0].property = 'effect.removed.amount';
    useTimelineStore.setState({ clips: [{ ...clip(), nodeGraph: graph }] });
    expect(target().map(k => k.value)).toEqual([1, 3]);
    expect(target().every(k => !k.animationSource)).toBe(true);
    removeKeyframeNode('clip-a', id);
    expect(target()).toHaveLength(2);
  });
  it('remaps every source and follower property together for copied or serialized owners', () => {
    linked();
    const graph = remapKeyframeNodeProperties(clip().nodeGraph, p => p.replace('scale.', 'position.'))!;
    expect(graph.keyframeNodes![0].channels[0]).toMatchObject({ property: 'position.x', targets: [{ property: 'position.y' }] });
    expect(clip().nodeGraph!.keyframeNodes![0].channels[0].property).toBe('scale.x');
  });
  it('reports shared curve bindings to existing AI keyframe tools', async () => {
    const id = linked();
    const result = await handleGetKeyframes({ clipId: 'clip-a' }, state());
    expect(result).toMatchObject({ success: true, data: { animationNodes: [{ id, channels: [{ property: 'scale.x', targets: [{ property: 'scale.y' }] }] }] } });
  });
  it('restores source curves and bindings through real history snapshots', () => {
    linked();
    const snapshot = createHistorySnapshot('Linked scale', { getTimelineState: state });
    state().updateKeyframe('b', { value: 9 });
    applyHistorySnapshot(snapshot, { getTimelineState: state, setTimelineState: next => useTimelineStore.setState(next as Partial<ReturnType<typeof state>>) });
    expect(source()[1].value).toBe(3);
    expect(target()[1].value).toBe(3);
    expect(clip().nodeGraph?.keyframeNodes?.[0].channels[0].targets).toHaveLength(1);
  });
  it('copies a clip with independent shared curves and new keyframe identities', () => {
    linked();
    state().selectClip('clip-a');
    state().copyClips();
    state().setPlayheadPosition(35);
    state().pasteClips();
    const copy = state().clips.find(c => c.id !== 'clip-a')!;
    expect(copy.nodeGraph?.keyframeNodes).toHaveLength(1);
    const copiedKeys = state().clipKeyframes.get(copy.id)!;
    const copiedSource = copiedKeys.find(k => k.property === 'scale.x' && k.time === 10)!;
    expect(copiedSource.id).not.toBe('b');
    state().updateKeyframe(copiedSource.id, { value: 8 });
    expect(state().clipKeyframes.get(copy.id)!.find(k => k.property === 'scale.y' && k.time === 10)?.value).toBe(8);
    expect(target()[1].value).toBe(3);
  });
  it('preserves bindings, hold transitions and Bezier handles through project save/load', () => {
    linked({ scale: 2, offset: 1 });
    state().updateKeyframe('a', { hold: true, handleOut: { x: 1, y: 0.5 } });
    const project = convertCompositions([{
      id: 'comp', name: 'Keyframe save test', type: 'composition', parentId: null, createdAt: 0,
      width: 1920, height: 1080, duration: 60, frameRate: 30, backgroundColor: '#000000', timelineData: state().getSerializableState(),
    }]);
    const [restored] = convertProjectCompositionToStore(JSON.parse(JSON.stringify(project)));
    const savedClip = restored.timelineData!.clips[0];
    expect(savedClip.nodeGraph?.keyframeNodes).toEqual(clip().nodeGraph?.keyframeNodes);
    expect(savedClip.keyframes?.find(k => k.id === 'a')).toMatchObject({ hold: true, handleOut: { x: 1, y: 0.5 } });
    expect(savedClip.keyframes?.find(k => k.property === 'scale.y')).toMatchObject({ hold: true, handleOut: { x: 1, y: 1 }, animationSource: { keyframeId: 'a' } });
  });
});
