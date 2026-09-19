import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { createFlockProperty } from '../../src/types/flock';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { useDockStore } from '../../src/stores/dockStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import type { TimelineStoreState } from '../../src/stores/historyStore/historyStoreTypes';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { findHistoryStateBoundaryViolations } from '../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../src/stores/timeline/historyTimelineRestoreState';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

function makeFlockClip(presetId: string, index: number): TimelineClip {
  return createMockClip({
    id: `flock-${index}`,
    name: presetId,
    startTime: index * 8,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    source: { type: 'flock', naturalDuration: 8 },
    flock: createFlockPresetDefinition(presetId),
    is3D: true,
  });
}

function emitterShape(clip: TimelineClip): unknown {
  return clip.flock?.nodes.find(node => node.operator === 'flock.emitter')?.params.shape;
}

describe('Flock history regression', () => {
  let timeline: TimelineStoreState;
  let originalClips: TimelineClip[];

  beforeEach(() => {
    originalClips = ['technical-network', 'krill-cloud', 'violet-filaments'].map(makeFlockClip);
    const emitter = originalClips[0].flock!.nodes.find(node => node.operator === 'flock.emitter')!;
    timeline = {
      duration: 24,
      clips: originalClips,
      tracks: [createMockTrack({ id: 'video-1' })],
      selectedClipIds: new Set(['flock-0']),
      zoom: 50,
      scrollX: 0,
      layers: [],
      selectedLayerId: null,
      clipKeyframes: new Map([['flock-0', [createMockKeyframe({
        clipId: 'flock-0',
        property: createFlockProperty(emitter.id, 'activeFraction'),
        time: 2.5,
        value: 0.7,
      })]]]),
      markers: [],
    };
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    initHistoryStoreRefs({
      timeline: {
        getState: () => timeline,
        setState: next => { timeline = { ...timeline, ...next }; },
      },
      media: { getState: useMediaStore.getState, setState: () => undefined },
      dock: { getState: useDockStore.getState, setState: () => undefined },
    });
    useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
    useHistoryStore.getState().clearHistory();
  });

  afterEach(() => {
    useHistoryStore.getState().clearHistory();
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  });

  it('captures detached JSON definitions in canonical and compatibility snapshots', () => {
    const graph = originalClips[0].flock!;
    graph.groups.push({
      id: 'saved-group', label: 'Saved behavior', version: 1,
      nodes: [structuredClone(graph.nodes[1])], edges: [], inputs: [], outputs: [], layout: {},
    });
    graph.cache = { precomputeStart: 1, precomputeEnd: 6, persist: true };
    // Unknown operators/versions in invalid drafts must survive history unchanged.
    graph.nodes.push({ id: 'future-node', operator: 'flock.future', operatorVersion: 9, params: {} });
    const expected = structuredClone(graph);
    const snapshot = createHistorySnapshot('Capture flock', { getTimelineState: () => timeline });

    expect(snapshot.timelineEditState!.timeline.clips[0].flock).toEqual(expected);
    expect(snapshot.timeline.clips[0].flock).toEqual(expected);
    expect(snapshot.timelineEditState!.timeline.clips[0].runtimeRef.kind).toBe('generated');
    expect(findHistoryStateBoundaryViolations(snapshot.timelineEditState)).toEqual([]);

    graph.nodes[0].params.count = 17;
    graph.groups[0].nodes[0].params.weight = 99;
    expect(snapshot.timelineEditState!.timeline.clips[0].flock).toEqual(expected);
    expect(snapshot.timeline.clips[0].flock).toEqual(expected);
  });

  it('undoes and redoes a node edit without losing any flock definitions or source-time keys', () => {
    const history = useHistoryStore.getState();
    const originalKeys = structuredClone(timeline.clipKeyframes);
    history.captureSnapshot('Three flocks');
    const edited = structuredClone(originalClips[0].flock!);
    edited.nodes.find(node => node.operator === 'flock.emitter')!.params.shape = 'box';
    timeline = { ...timeline, clips: [{ ...originalClips[0], flock: edited }, ...originalClips.slice(1)] };
    history.captureSnapshot('Emitter shape: box');

    for (let cycle = 0; cycle < 2; cycle += 1) {
      expect(history.undo()).not.toBeNull();
      expect(timeline.clips.map(clip => clip.flock)).toEqual(originalClips.map(clip => clip.flock));
      expect(timeline.clips.every(clip => clip.source?.type === 'flock' && clip.needsReload === false)).toBe(true);
      expect(timeline.clipKeyframes).toEqual(originalKeys);
      expect(emitterShape(timeline.clips[0])).toBe('sphere');

      expect(history.redo()).not.toBeNull();
      expect(timeline.clips[0].flock).toEqual(edited);
      expect(timeline.clips.slice(1).map(clip => clip.flock)).toEqual(originalClips.slice(1).map(clip => clip.flock));
      expect(timeline.clipKeyframes).toEqual(originalKeys);
      expect(timeline.clips.every(clip => clip.needsReload === false)).toBe(true);
    }
  });

  it('restores a deleted flock from history without a media file or live runtime', () => {
    const history = useHistoryStore.getState();
    history.captureSnapshot('Before deletion');
    timeline = { ...timeline, clips: originalClips.slice(1), selectedClipIds: new Set() };
    history.captureSnapshot('Delete first flock');

    expect(history.undo()).not.toBeNull();
    expect(timeline.clips[0].flock).toEqual(originalClips[0].flock);
    expect(timeline.clips[0].needsReload).toBe(false);
    expect(timeline.clips[0].source).toMatchObject({ type: 'flock', naturalDuration: 8 });
    expect(timeline.clips[0].mediaFileId).toBeUndefined();
    expect(history.redo()).not.toBeNull();
    expect(timeline.clips.map(clip => clip.id)).toEqual(['flock-1', 'flock-2']);
    expect(timeline.clips.every(clip => clip.flock && !clip.needsReload)).toBe(true);
  });

  it('restores serialized history independently and does not invent missing legacy definitions', () => {
    const snapshot = createHistorySnapshot('Persisted snapshot', { getTimelineState: () => timeline });
    const persisted = JSON.parse(JSON.stringify(snapshot.timelineEditState!));
    const restored = createHistoryTimelineRestoreState(persisted, {}).state;
    expect(restored.clips.map(clip => clip.flock)).toEqual(originalClips.map(clip => clip.flock));
    expect(restored.clips.every(clip => clip.needsReload === false)).toBe(true);
    restored.clips[0].flock!.nodes[0].params.count = 11;
    expect(persisted.timeline.clips[0].flock.nodes[0].params.count).not.toBe(11);

    delete persisted.timeline.clips[0].flock;
    persisted.timeline.clips[0].runtimeRef.kind = 'missing-media';
    const legacy = createHistoryTimelineRestoreState(persisted, {}).state;
    expect(legacy.clips[0].flock).toBeUndefined();
    expect(legacy.clips[0].needsReload).toBe(true);
  });
});
