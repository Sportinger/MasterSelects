import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();

const glyphEffects = [
  { type: 'ascii', name: 'ASCII', cellSize: 14 },
  { type: 'number-field', name: 'Number Field', cellSize: 14 },
  { type: 'grid-glyph', name: 'Grid Glyph', cellSize: 14 },
  { type: 'pixel-code', name: 'Pixel Code', cellSize: 10 },
  { type: 'word-mosaic', name: 'Word Mosaic', cellSize: 22 },
  { type: 'brand-generator', name: 'Brand Generator', cellSize: 24 },
  { type: 'stitch-poster', name: 'Stitch Poster', cellSize: 12 },
  { type: 'inscribe', name: 'Inscribe', cellSize: 14 },
] as const;

describe('glyph image graph lifecycle', () => {
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

  it.each(glyphEffects)('$name creates, edits, animates, serializes, and restores its canonical atlas graph', async ({ type, name, cellSize }) => {
    const effectId = `${type}-fx`;
    const base: Effect = { id: effectId, type, name, enabled: true, params: {} };
    const canonical = migratePersistedEffectOperatorGraph(base);
    const originalGraph = structuredClone(canonical.operatorGraph!);
    const originalParams = structuredClone(canonical.params);
    const originalRamp = effectOperatorParams(canonical).customRamp;
    const atlas = canonical.operatorGraph!.nodes.find(node => node.operator === 'glyph.atlas')!;
    expect(atlas.bindings).toEqual({ rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' });
    expect(effectOperatorGraph(canonical)).toEqual(canonical.operatorGraph);
    expect(effectOperatorParams(canonical)).toMatchObject({ cellSize, amount: 1, fontWeight: 600 });

    const clip = createMockClip({ id: `${type}-clip`, effects: [canonical], source: { type: 'solid' }, solidColor: '#315779' });
    const property = `effect.${effectId}.fontWeight` as Keyframe['property'];
    const keys: Keyframe[] = [
      { id: 'weight-0', clipId: clip.id, property, time: 0, value: 300, easing: 'linear' },
      { id: 'weight-2', clipId: clip.id, property, time: 2, value: 900, easing: 'linear' },
    ];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
    editEffectGraph(clip.id, canonical.id, `Edit ${name} glyph atlas`, (graph, params) => {
      graph.layout = { ...graph.layout, atlas: { x: 432, y: 210 } };
      params.customRamp = ' .@';
    });
    expect(useTimelineStore.getState().clips[0].effects[0].params.customRamp).toBe(' .@');
    const editedGraph = structuredClone(useTimelineStore.getState().clips[0].effects[0].operatorGraph!);
    expect(editedGraph.layout?.atlas).toEqual({ x: 432, y: 210 });
    expect(evaluateCompositionClipEffects([canonical], keys, 1)[0].params.fontWeight).toBe(600);

    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    const undone = useTimelineStore.getState().clips[0].effects[0];
    expect(undone.params).toEqual(originalParams);
    expect(effectOperatorParams(undone).customRamp).toBe(originalRamp);
    expect(undone.operatorGraph).toEqual(originalGraph);
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    const redone = useTimelineStore.getState().clips[0].effects[0];
    expect(redone.params.customRamp).toBe(' .@');
    expect(redone.operatorGraph).toEqual(editedGraph);

    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips[0].effects[0];
    expect(restored.params.customRamp).toBe(' .@');
    expect(effectOperatorGraph(restored)).toEqual(editedGraph);
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)?.map(key => key.value)).toEqual([300, 900]);
  });
});
