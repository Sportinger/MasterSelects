import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
const cases = [
  { type: 'chroma-key', id: 'chroma-fx', key: 'tolerance', values: [.12, .42], bypassNode: 'outer-tolerance' },
  { type: 'rom1', id: 'rom1-fx', key: 'opacity', values: [.2, .85], bypassNode: 'wet-mix' },
] as const;

describe('Chroma Key and ROM1 graph lifecycle', () => {
  beforeEach(() => {
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
      dock: { getState: () => ({ layout: null }), setState: () => undefined } });
    getHistoryStateView().clearHistory();
  });
  afterEach(() => { getHistoryStateView().clearHistory(); useTimelineStore.setState(initial); });

  it.each(cases)('preserves $type owner defaults, keyframes, graph bypass, undo/redo, and serialization', async testCase => {
    const definition = getEffect(testCase.type)!;
    expect(definition.params[testCase.key]).toMatchObject({ default: expect.any(Number), min: expect.any(Number), max: expect.any(Number) });
    const base: Effect = { id: testCase.id, type: testCase.type, name: definition.name, enabled: true, params: {} };
    const canonical = migratePersistedEffectOperatorGraph(base), original = structuredClone(canonical.operatorGraph!);
    expect(effectOperatorParams(canonical)[testCase.key]).toBe(definition.params[testCase.key].default);
    const clip = createMockClip({ id: `${testCase.type}-clip`, effects: [canonical], source: { type: 'solid' }, solidColor: '#315779' });
    const property = `effect.${testCase.id}.${testCase.key}` as Keyframe['property'];
    const keys: Keyframe[] = [{ id: `${testCase.key}-0`, clipId: clip.id, property, time: 0, value: testCase.values[0], easing: 'linear' },
      { id: `${testCase.key}-2`, clipId: clip.id, property, time: 2, value: testCase.values[1], easing: 'linear' }];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });

    editEffectGraph(clip.id, canonical.id, `Edit ${definition.name} graph`, (graph, params) => {
      graph.nodes.find(node => node.id === testCase.bypassNode)!.bypassed = true;
      graph.layout[testCase.bypassNode] = { x: 444, y: 222 };
      params[testCase.key] = testCase.values[1];
    });
    const edited = structuredClone(useTimelineStore.getState().clips[0].effects[0]);
    expect(edited.operatorGraph?.nodes.find(node => node.id === testCase.bypassNode)?.bypassed).toBe(true);
    expect(edited.operatorGraph?.layout[testCase.bypassNode]).toEqual({ x: 444, y: 222 });
    expect(edited.params[testCase.key]).toBe(testCase.values[1]);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph).toEqual(original);
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });

    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips[0].effects[0];
    expect(effectOperatorGraph(restored)).toEqual(edited.operatorGraph);
    expect(restored.params[testCase.key]).toBe(testCase.values[1]);
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)?.map(key => [key.id, key.value]))
      .toEqual([[`${testCase.key}-0`, testCase.values[0]], [`${testCase.key}-2`, testCase.values[1]]]);
  });
});
