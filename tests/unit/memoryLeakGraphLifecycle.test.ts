import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultMemoryLeakGraph } from '../../src/services/operators/memoryLeakEffectGraph';
import { editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import {
  effectOperatorCompileContext,
  effectOperatorGraph,
  effectOperatorParams,
  hasEffectOperatorGraph,
  isImageGraphEffectType,
  migratePersistedEffectOperatorGraph,
} from '../../src/services/operators/effectGraphOwner';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();

describe('Memory Leak image graph lifecycle', () => {
  beforeEach(() => {
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    initHistoryStoreRefs({
      timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
      dock: { getState: () => ({ layout: null }), setState: () => undefined },
    });
    getHistoryStateView().clearHistory();
  });

  afterEach(() => { getHistoryStateView().clearHistory(); useTimelineStore.setState(initial); });

  it('migrates the legacy default, edits, animates, undoes, serializes, and restores canonical state', async () => {
    const legacy: Effect = { id: 'memory-fx', type: 'memory-leak', name: 'Memory Leak', enabled: true, params: {} };
    const canonical = migratePersistedEffectOperatorGraph(legacy), definition = getEffect('memory-leak')!;
    expect(isImageGraphEffectType('memory-leak')).toBe(true);
    expect(hasEffectOperatorGraph('memory-leak')).toBe(true);
    expect(canonical.operatorGraph).toEqual(createDefaultMemoryLeakGraph());
    expect(effectOperatorGraph(canonical)).toEqual(canonical.operatorGraph);
    expect(effectOperatorCompileContext(canonical)).toMatchObject({ parameterSchema: definition.params, allowMemoryWindow: true });
    expect(effectOperatorParams(canonical)).toMatchObject({
      size: 320, depth: '8', offset: 0, motion: 'advance', stride: 64, seed: 1,
      floatMode: 'wrap', floatGain: 1, opaque: true, mix: 1, snapshot: '',
    });
    expect(definition.params.size).toMatchObject({ default: 320, min: 8, max: 1024, animatable: true });
    expect(canonical.operatorGraph!.nodes.find(node => node.id === 'memory')?.bindings)
      .toEqual({ size: 'size', depth: 'depth', offset: 'offset', motion: 'motion', stride: 'stride', seed: 'seed', snapshot: 'snapshot' });
    expect(canonical.operatorGraph!.nodes.find(node => node.id === 'float-gain')?.bindings.value).toBe('floatGain');
    expect(canonical.operatorGraph!.nodes.find(node => node.id === 'mix')?.bindings.value).toBe('mix');
    const originalGraph = structuredClone(canonical.operatorGraph!), originalParams = structuredClone(canonical.params);

    const clip = createMockClip({ id: 'memory-clip', effects: [canonical], source: { type: 'solid' }, solidColor: '#315779' });
    const property = `effect.${canonical.id}.size` as Keyframe['property'];
    const keys: Keyframe[] = [
      { id: 'memory-size-0', clipId: clip.id, property, time: 0, value: 8, easing: 'linear' },
      { id: 'memory-size-2', clipId: clip.id, property, time: 2, value: 1024, easing: 'linear' },
    ];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
    editEffectGraph(clip.id, canonical.id, 'Edit Memory Leak graph', (graph, params) => {
      graph.layout = { ...graph.layout, memory: { x: 456, y: 234 } };
      params.motion = 'shuffle'; params.seed = 77; params.snapshot = 'artifact:memory-window'; params.floatGain = 2.5;
    });
    expect(evaluateCompositionClipEffects([canonical], keys, 1)[0].params.size).toBe(516);

    const edited = useTimelineStore.getState().clips[0].effects[0];
    expect(edited.operatorGraph?.layout.memory).toEqual({ x: 456, y: 234 });
    expect(edited.params).toMatchObject({ motion: 'shuffle', seed: 77, snapshot: 'artifact:memory-window', floatGain: 2.5 });
    const editedGraph = structuredClone(edited.operatorGraph!), editedParams = structuredClone(edited.params);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips[0].effects[0]).toMatchObject({ operatorGraph: originalGraph, params: originalParams });
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    expect(useTimelineStore.getState().clips[0].effects[0]).toMatchObject({ operatorGraph: editedGraph, params: editedParams });

    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips[0].effects[0];
    expect(restored.operatorGraph).toEqual(editedGraph);
    expect(restored.params).toEqual(editedParams);
    expect(effectOperatorGraph(restored)).toEqual(editedGraph);
    expect(effectOperatorParams(restored)).toMatchObject({ size: 320, motion: 'shuffle', seed: 77, snapshot: 'artifact:memory-window', floatGain: 2.5 });
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)?.map(key => key.value)).toEqual([8, 1024]);
  });
});
