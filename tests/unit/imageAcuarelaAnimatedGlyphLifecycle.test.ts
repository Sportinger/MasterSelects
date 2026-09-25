import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaEffectGraph';
import { createDefaultAsciiGhostGraph, createDefaultCapsuleCloudGraph, createDefaultDataHatchGraph, createDefaultDitherTextGraph, createDefaultGlyphMatrixGraph, createDefaultMatrixGraph, createDefaultPixelDitherGraph, createDefaultRetroMatrixGraph, createDefaultSymbolMatrixGraph, createDefaultUiCollageGraph } from '../../src/services/operators/asciiEffectGraph';
import { EFFECT_GRAPH_PARAM } from '../../src/services/operators/effectGraph';
import { editEffectGraph } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { expandOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
const cases = [
  { type: 'acuarela', name: 'Acuarela', factory: createDefaultAcuarelaGraph, speedDefault: 4, speedMax: 40, feedback: true },
  { type: 'glyph-matrix', name: 'Glyph Matrix', factory: createDefaultGlyphMatrixGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'data-hatch', name: 'Data Hatching', factory: createDefaultDataHatchGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'dither-text', name: 'Dither Text', factory: createDefaultDitherTextGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'symbol-matrix', name: 'Symbol Matrix', factory: createDefaultSymbolMatrixGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'pixel-dither', name: 'Pixel Dither Glow', factory: createDefaultPixelDitherGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'retro-matrix', name: 'Retro Matrix', factory: createDefaultRetroMatrixGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'capsule-cloud', name: 'Tag Pills', factory: createDefaultCapsuleCloudGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'ui-collage', name: 'Creative UI Collage', factory: createDefaultUiCollageGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'matrix', name: 'Matrix Rain', factory: createDefaultMatrixGraph, speedDefault: 1, speedMax: 5, feedback: false },
  { type: 'ascii-ghost', name: 'ASCII Ghost', factory: createDefaultAsciiGhostGraph, speedDefault: 1, speedMax: 5, feedback: true },
] as const;

describe('Acuarela and animated glyph image graph lifecycle', () => {
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

  it.each(cases)('$name migrates, edits, keyframes, serializes, and restores its canonical graph', async item => {
    const legacyGraph = item.factory();
    const base: Effect = { id: `${item.type}-fx`, type: item.type, name: item.name, enabled: true,
      params: { [EFFECT_GRAPH_PARAM]: JSON.stringify(legacyGraph) } };
    const canonical = migratePersistedEffectOperatorGraph(base);
    const definition = getEffect(item.type)!;
    expect(canonical.params).not.toHaveProperty(EFFECT_GRAPH_PARAM);
    // Projects persist packed shared blocks; the runtime resolves their exact expansion.
    expect(effectOperatorGraph(canonical)).toEqual(expandOperatorCompositions(canonical.operatorGraph!));
    expect(effectOperatorParams(canonical).speed).toBe(item.speedDefault);
    expect(definition.params.speed).toMatchObject({ default: item.speedDefault, min: 0, max: item.speedMax, animatable: true });
    expect(canonical.operatorGraph!.nodes.some(node => node.bindings.value === 'speed')).toBe(true);
    expect(effectOperatorCompileContext(canonical).allowFrameHistory === true).toBe(item.feedback);
    const originalGraph = structuredClone(canonical.operatorGraph!);
    const originalParams = structuredClone(canonical.params);

    const clip = createMockClip({ id: `${item.type}-clip`, effects: [canonical], source: { type: 'solid' }, solidColor: '#315779' });
    const property = `effect.${canonical.id}.speed` as Keyframe['property'];
    const keys: Keyframe[] = [
      { id: `${item.type}-speed-0`, clipId: clip.id, property, time: 0, value: 0, easing: 'linear' },
      { id: `${item.type}-speed-2`, clipId: clip.id, property, time: 2, value: item.speedMax, easing: 'linear' },
    ];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
    editEffectGraph(clip.id, canonical.id, `Edit ${item.name} graph`, (graph, params) => {
      graph.layout = { ...graph.layout, speed: { x: 444, y: 222 } };
      params.speed = item.speedDefault;
    });
    expect(evaluateCompositionClipEffects([canonical], keys, 1)[0].params.speed).toBe(item.speedMax / 2);

    const edited = useTimelineStore.getState().clips[0].effects[0];
    expect(edited.operatorGraph?.layout.speed).toEqual({ x: 444, y: 222 });
    const editedGraph = structuredClone(edited.operatorGraph!);
    const editedParams = structuredClone(edited.params);
    expect(getHistoryStateView().undo()).toMatchObject({ operation: 'undo' });
    const undone = useTimelineStore.getState().clips[0].effects[0];
    expect(undone.operatorGraph).toEqual(originalGraph);
    expect(undone.params).toEqual(originalParams);
    expect(effectOperatorParams(undone).speed).toBe(item.speedDefault);
    expect(getHistoryStateView().redo()).toMatchObject({ operation: 'redo' });
    const redone = useTimelineStore.getState().clips[0].effects[0];
    expect(redone.operatorGraph).toEqual(editedGraph);
    expect(redone.params).toEqual(editedParams);

    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips[0].effects[0];
    expect(restored.operatorGraph).toEqual(editedGraph);
    expect(restored.params).toEqual(editedParams);
    expect(effectOperatorGraph(restored)).toEqual(expandOperatorCompositions(editedGraph));
    expect(useTimelineStore.getState().clipKeyframes.get(clip.id)?.map(key => key.value)).toEqual([0, item.speedMax]);
  });
});
