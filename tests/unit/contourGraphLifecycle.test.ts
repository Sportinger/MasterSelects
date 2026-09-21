import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();

describe('Contour compute graph lifecycle', () => {
  beforeEach(() => {
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
      dock: { getState: () => ({ layout: null }), setState: () => undefined } });
    getHistoryStateView().clearHistory();
  });
  afterEach(() => { getHistoryStateView().clearHistory(); useTimelineStore.setState(initial); });

  it('preserves graph edits, catalog-bound keyframes, undo/redo, and serialization', async () => {
    const base: Effect = { id: 'contour-fx', type: 'contour', name: 'Contour', enabled: true, params: {} };
    const canonical = migratePersistedEffectOperatorGraph(base), original = structuredClone(canonical.operatorGraph!);
    const clip = createMockClip({ id: 'contour-clip', effects: [canonical], source: { type: 'solid' }, solidColor: '#315779' });
    const property = 'effect.contour-fx.threshold' as Keyframe['property'];
    const keys: Keyframe[] = [{ id: 'threshold-0', clipId: clip.id, property, time: 0, value: .2, easing: 'linear' },
      { id: 'threshold-2', clipId: clip.id, property, time: 2, value: .8, easing: 'linear' }];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
    editEffectGraph(clip.id, canonical.id, 'Edit Contour graph', (graph, params) => {
      graph.layout.topology = { x: 444, y: 222 }; params.scale = 17;
    });
    const edited = structuredClone(useTimelineStore.getState().clips[0].effects[0]);
    expect(edited.operatorGraph?.layout.topology).toEqual({ x: 444, y: 222 }); expect(edited.params.scale).toBe(17);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph).toEqual(original);
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips[0].effects[0];
    expect(effectOperatorGraph(restored)).toEqual(edited.operatorGraph); expect(restored.params.scale).toBe(17);
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)?.map(key => [key.id, key.value]))
      .toEqual([['threshold-0', .2], ['threshold-2', .8]]);
  });
});
