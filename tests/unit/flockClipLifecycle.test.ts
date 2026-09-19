import { beforeEach, describe, expect, it } from 'vitest';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { createMockTrack, resetIdCounter } from '../helpers/mockData';
import { createFlockClipSlice } from '../../src/stores/timeline/flockClipSlice';
import type { TimelineStore } from '../../src/stores/timeline/types';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import { createFlockProperty, parseFlockProperty, type FlockDefinition } from '../../src/types/flock';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { createLoadStateGeneratedClip } from '../../src/stores/timeline/serialization/loadStateGeneratedClipRestore';
import { normalizeRestoredFlockDefinition } from '../../src/stores/timeline/serialization/flockDefinitionRestore';
import { createRestoredFlockClip } from '../../src/stores/timeline/nestedRestore';
import { isInfiniteTimelineClipSource } from '../../src/utils/clipSourceTiming';

type TestStore = ReturnType<typeof createTestTimelineStore>;

function flockActions(store: TestStore) {
  return createFlockClipSlice(
    store.setState as Parameters<typeof createFlockClipSlice>[0],
    store.getState as Parameters<typeof createFlockClipSlice>[1],
    undefined as never,
  );
}

function rulesProperty(definition: FlockDefinition) {
  const rules = definition.nodes.find((node) => node.operator === 'flock.rules')!;
  return createFlockProperty(rules.id, 'cohesion');
}

function flockKeyframe(clipId: string, property: Keyframe['property'], time: number, value: number): Keyframe {
  return { id: `kf-${time}-${value}`, clipId, property, time, value, easing: 'linear' };
}

function addFlockClipWithKeyframes(store: TestStore): { clip: TimelineClip; keyframes: Keyframe[] } {
  const clipId = flockActions(store).addFlockClip('video-1', 0, { duration: 10 })!;
  const clip = store.getState().clips.find((candidate) => candidate.id === clipId)!;
  const property = rulesProperty(clip.flock!);
  // Source-time keys, including one that will sit before the second split part's window.
  const keyframes = [flockKeyframe(clipId, property, 1, 0.5), flockKeyframe(clipId, property, 7.5, 3)];
  store.setState({ clipKeyframes: new Map([[clipId, keyframes]]) } as Partial<TimelineStore>);
  return { clip, keyframes };
}

describe('flock clip lifecycle', () => {
  let store: TestStore;

  beforeEach(() => {
    resetIdCounter();
    store = createTestTimelineStore();
  });

  it('adds a flock clip on an unlocked video track and refuses locked or audio tracks', () => {
    const clipId = flockActions(store).addFlockClip('video-1', 2);
    const clip = store.getState().clips.find((candidate) => candidate.id === clipId);
    expect(clip?.source?.type).toBe('flock');
    expect(clip?.is3D).toBe(true);
    expect(clip?.flock?.nodes.length).toBeGreaterThan(0);

    expect(flockActions(store).addFlockClip('audio-1', 0)).toBeNull();
    const locked = createTestTimelineStore({ tracks: [createMockTrack({ id: 'locked-video', locked: true })] });
    expect(flockActions(locked).addFlockClip('locked-video', 0)).toBeNull();
    expect(locked.getState().clips).toHaveLength(0);
  });

  it('is an extendable (infinite) source', () => {
    expect(isInfiniteTimelineClipSource({ source: { type: 'flock' } })).toBe(true);
  });

  it('splits into independent definitions that both keep the full source-time keyframe history', () => {
    const { clip, keyframes } = addFlockClipWithKeyframes(store);
    store.getState().splitClip(clip.id, 4);

    const parts = store.getState().clips.filter((candidate) => candidate.source?.type === 'flock');
    expect(parts).toHaveLength(2);
    const [first, second] = parts.toSorted((a, b) => a.startTime - b.startTime);
    expect(second.inPoint).toBeCloseTo(4, 8);
    expect(first.flock).toEqual(clip.flock);
    expect(second.flock).toEqual(clip.flock);
    expect(first.flock).not.toBe(second.flock);
    first.flock!.nodes[0].label = 'mutated';
    expect(second.flock!.nodes[0].label).toBeUndefined();

    for (const part of [first, second]) {
      const partKeyframes = store.getState().clipKeyframes.get(part.id) ?? [];
      expect(partKeyframes.map((keyframe) => [keyframe.property, keyframe.time, keyframe.value]))
        .toEqual(keyframes.map((keyframe) => [keyframe.property, keyframe.time, keyframe.value]));
      expect(partKeyframes.every((keyframe) => keyframe.clipId === part.id)).toBe(true);
      expect(partKeyframes.some((keyframe) => keyframes.some((original) => original.id === keyframe.id))).toBe(false);
    }
  });

  it('batch split-at-times copies flock keyframes to every part', () => {
    const { clip, keyframes } = addFlockClipWithKeyframes(store);
    const result = store.getState().applyTimelineEditOperation({ id: 'split', type: 'split-at-times', clipId: clip.id, times: [3, 6] }, {});
    expect(result.success).toBe(true);
    const parts = store.getState().clips.filter((candidate) => candidate.source?.type === 'flock');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part.flock).toEqual(clip.flock);
      expect((store.getState().clipKeyframes.get(part.id) ?? []).map((keyframe) => keyframe.time))
        .toEqual(keyframes.map((keyframe) => keyframe.time));
    }
  });

  it('does not shift source-time flock keyframes on an edge trim, while clip-local keys stay anchored', () => {
    const { clip } = addFlockClipWithKeyframes(store);
    const opacityKey: Keyframe = { id: 'kf-opacity', clipId: clip.id, property: 'opacity', time: 5, value: 0.5, easing: 'linear' };
    store.setState({
      clipKeyframes: new Map([[clip.id, [...store.getState().clipKeyframes.get(clip.id)!, opacityKey]]]),
    } as Partial<TimelineStore>);

    const result = store.getState().applyTimelineEditOperation({
      id: 'trim',
      type: 'trim-clip',
      clipId: clip.id,
      inPoint: 2,
      outPoint: 10,
      startTime: 2,
    }, {});
    expect(result.success).toBe(true);
    const trimmed = store.getState().clips.find((candidate) => candidate.id === clip.id)!;
    expect(trimmed.inPoint).toBeCloseTo(2, 8);
    const after = store.getState().clipKeyframes.get(clip.id)!;
    expect(after.filter((keyframe) => keyframe.property.startsWith('flock.')).map((keyframe) => keyframe.time)).toEqual([1, 7.5]);
    expect(after.find((keyframe) => keyframe.id === 'kf-opacity')?.time).toBeCloseTo(3, 8);
  });

  it('pastes an independent copy with remapped node ids and keyframe properties', () => {
    const { clip, keyframes } = addFlockClipWithKeyframes(store);
    const clipboardData = [{
      id: clip.id,
      trackId: clip.trackId,
      trackType: 'video',
      name: clip.name,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      sourceType: 'flock',
      naturalDuration: clip.duration,
      transform: clip.transform,
      effects: [],
      keyframes,
      flock: structuredClone(clip.flock),
      is3D: true,
    }] as unknown as ClipboardClipData[];

    const plan = createPastedClipboardClipsPlan({
      clipboardData,
      playheadPosition: 20,
      tracks: store.getState().tracks,
      clipKeyframes: new Map(),
      timestamp: 1,
      createSuffix: () => Math.random().toString(36).slice(2, 7),
    });
    const pasted = plan.newClips[0];
    expect(pasted.source?.type).toBe('flock');
    expect(pasted.isLoading).toBe(false);
    const originalIds = new Set(clip.flock!.nodes.map((node) => node.id));
    expect(pasted.flock!.nodes.some((node) => originalIds.has(node.id))).toBe(false);
    expect(pasted.flock!.exposed.every((exposed) => pasted.flock!.nodes.some((node) => node.id === exposed.nodeId))).toBe(true);

    const pastedKeyframes = plan.newKeyframes.get(pasted.id)!;
    expect(pastedKeyframes).toHaveLength(2);
    for (const keyframe of pastedKeyframes) {
      const parsed = parseFlockProperty(keyframe.property)!;
      const node = pasted.flock!.nodes.find((candidate) => candidate.id === parsed.nodeId);
      expect(node?.operator).toBe('flock.rules');
      expect(keyframe.clipId).toBe(pasted.id);
    }
  });

  it('round-trips the definition through serialization and restore', async () => {
    const { clip } = addFlockClipWithKeyframes(store);
    const serialized = createSerializableTimelineState(store.getState() as never);
    const serializedClip = serialized.clips.find((candidate) => candidate.id === clip.id)!;
    expect(serializedClip.sourceType).toBe('flock');
    expect(serializedClip.flock).toEqual(clip.flock);
    expect(serializedClip.flock).not.toBe(clip.flock);
    expect(serializedClip.keyframes).toHaveLength(2);

    const restored = await createLoadStateGeneratedClip({ serializedClip, mediaStore: {} as never });
    expect(restored?.source?.type).toBe('flock');
    expect(restored?.flock).toEqual(clip.flock);
    expect(restored?.is3D).toBe(true);
    expect(restored?.source).not.toHaveProperty('textCanvas');

    const nested = createRestoredFlockClip(serializedClip, 'nested-1');
    expect(nested?.flock).toEqual(clip.flock);
    expect(nested?.source?.type).toBe('flock');
  });

  it('keeps unknown operators and newer versions instead of dropping a persisted definition', () => {
    const raw = {
      version: 7,
      nodes: [{ id: 'fn-future', operator: 'flock.future', operatorVersion: 3, params: { x: 1 } }],
      edges: [],
    };
    const normalized = normalizeRestoredFlockDefinition(raw)!;
    expect(normalized.version).toBe(7);
    expect(normalized.nodes[0].operator).toBe('flock.future');
    expect(normalized.groups).toEqual([]);
    expect(normalized.time).toEqual({ loop: 'none', loopSeconds: 10 });
    expect(normalizeRestoredFlockDefinition(null)).toBeNull();
  });
});
