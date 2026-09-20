import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultInvertImageGraph, compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { setOperatorConstant } from '../../src/services/operators/effectGraphEditing';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { useTimelineStore } from '../../src/stores/timeline';
import { captureSnapshot, getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { Effect, Keyframe, TimelineClip } from '../../src/types';
import { buildBaseLayerProps } from '../../src/engine/export/layerBuilder/baseLayers';

const initialTimeline = useTimelineStore.getState();
const pixel: [number, number, number, number] = [0.2, 0.4, 0.8, 0.75];

function imageEffect(): Effect {
  const operatorGraph = createDefaultInvertImageGraph();
  const one = operatorGraph.nodes.find(node => node.id === 'one')!;
  one.bindings.value = 'invertCeiling';
  delete one.constants?.value;
  return { id: 'invert-fx', type: 'invert', name: 'Invert', enabled: true, params: { invertCeiling: 1 }, operatorGraph };
}

function evaluatedPixel(effect: Effect, keys: Keyframe[], time: number) {
  const evaluated = evaluateCompositionClipEffects([effect], keys, time)[0];
  return evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(evaluated), evaluated.params), pixel);
}

describe('image graph lifecycle parity', () => {
  beforeEach(() => {
    setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
    initHistoryStoreRefs({
      timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
      dock: { getState: () => ({ layout: null }), setState: () => undefined },
    });
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimeline);
  });

  it('evaluates preview and export interpolation into identical real pixels at clip-local keyframe times', () => {
    const effect = imageEffect();
    const keys: Keyframe[] = [
      { id: 'one-0', clipId: 'clip-image', property: 'effect.invert-fx.invertCeiling', time: 0, value: 1, easing: 'linear' },
      { id: 'one-2', clipId: 'clip-image', property: 'effect.invert-fx.invertCeiling', time: 2, value: 0.5, easing: 'linear' },
    ];
    const clip = createMockClip({ id: 'clip-image', effects: [effect], speed: 0.5, inPoint: 1 });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });

    for (const localTime of [0, 1, 2]) {
      const preview = useTimelineStore.getState().getInterpolatedEffects(clip.id, localTime)[0];
      const previewPixel = evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(preview), preview.params), pixel);
      const exported = buildBaseLayerProps(clip, localTime, 0, {
        time: localTime,
        getInterpolatedTransform: () => clip.transform,
        getInterpolatedEffects: (_clipId: string, time: number) => evaluateCompositionClipEffects([effect], keys, time),
        getInterpolatedColorCorrection: () => undefined,
      } as never)!;
      const exportEffect = exported.effects[0];
      const exportPixel = evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(exportEffect), exportEffect.params), pixel);
      expect(previewPixel).toEqual(exportPixel);
      expect(exportPixel).toEqual(evaluatedPixel(effect, keys, localTime));
    }
    expect(evaluatedPixel(effect, keys, 2)).toEqual([0.3, 0.09999999999999998, -0.30000000000000004, 0.75]);
  });

  it('keeps remaining pointwise graph parameter interpolation identical in preview and export', () => {
    const cases = [
      { type: 'exposure', parameter: 'exposure', from: 0, to: 2, expected: 1 },
      { type: 'levels', parameter: 'gamma', from: 0.5, to: 1.5, expected: 1 },
      { type: 'hue-shift', parameter: 'shift', from: 0, to: 1, expected: 0.5 },
      { type: 'temperature', parameter: 'temperature', from: -1, to: 1, expected: 0 },
      { type: 'vibrance', parameter: 'amount', from: -1, to: 1, expected: 0 },
      { type: 'threshold', parameter: 'level', from: 0.2, to: 0.8, expected: 0.5 },
      { type: 'posterize', parameter: 'levels', from: 2, to: 10, expected: 6 },
      { type: 'vignette', parameter: 'amount', from: 0, to: 1, expected: 0.5 },
    ] as const;
    for (const item of cases) {
      const id = `${item.type}-lifecycle`, clipId = `${item.type}-clip`;
      const effect: Effect = { id, type: item.type, name: item.type, enabled: true, params: {} };
      const property = `effect.${id}.${item.parameter}` as Keyframe['property'];
      const keys: Keyframe[] = [
        { id: `${id}-0`, clipId, property, time: 0, value: item.from, easing: 'linear' },
        { id: `${id}-2`, clipId, property, time: 2, value: item.to, easing: 'linear' },
      ];
      const clip = createMockClip({ id: clipId, effects: [effect] });
      useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
      const preview = useTimelineStore.getState().getInterpolatedEffects(clip.id, 1)[0];
      const exported = buildBaseLayerProps(clip, 1, 0, {
        time: 1,
        getInterpolatedTransform: () => clip.transform,
        getInterpolatedEffects: (_clipId: string, time: number) => evaluateCompositionClipEffects([effect], keys, time),
        getInterpolatedColorCorrection: () => undefined,
      } as never)!.effects[0];
      const previewParams = effectOperatorParams(preview), exportParams = effectOperatorParams(exported);
      expect(previewParams[item.parameter]).toBeCloseTo(item.expected);
      expect(exportParams[item.parameter]).toBeCloseTo(item.expected);
      const previewPixel = evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(preview), previewParams), pixel, { uv: [0.9, 0.5] });
      const exportPixel = evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(exported), exportParams), pixel, { uv: [0.9, 0.5] });
      expect(previewPixel).toEqual(exportPixel);
      expect(exportPixel[3]).toBe(pixel[3]);
      const endpointPlans = [0, 2].map(time => {
        const sampled = evaluateCompositionClipEffects([effect], keys, time)[0];
        return compileImageOperatorGraph(effectOperatorGraph(sampled), effectOperatorParams(sampled));
      });
      expect(endpointPlans[0].key).toBe(endpointPlans[1].key);
      expect(endpointPlans[0].wgsl).toBe(endpointPlans[1].wgsl);
      expect(endpointPlans[0].values).not.toEqual(endpointPlans[1].values);
    }
  });

  it('restores graph constants through undo/redo and canonical save/load without runtime payloads', async () => {
    const effect = imageEffect();
    delete effect.operatorGraph!.nodes.find(node => node.id === 'one')!.bindings.value;
    effect.operatorGraph!.nodes.find(node => node.id === 'one')!.constants = { value: 1 };
    effect.operatorGraph!.layout.one = { x: 432, y: 210 };
    effect.operatorGraph!.groups = [{ id: 'math', label: 'Math', color: '#778899', nodeIds: ['one'] }];
    const clip = createMockClip({ id: 'clip-lifecycle', effects: [effect], source: { type: 'solid' }, solidColor: '#112233' } as Partial<TimelineClip>);
    const track = createMockTrack({ id: clip.trackId });
    useTimelineStore.setState({ clips: [clip], tracks: [track], clipKeyframes: new Map(), selectedClipIds: new Set(), layers: [], markers: [], isExporting: false });
    captureSnapshot('before graph edit');
    setOperatorConstant(clip.id, effect.id, 'one', 'value', 0.6);
    expect(effectOperatorGraph(useTimelineStore.getState().clips[0].effects[0]).nodes.find(node => node.id === 'one')?.constants?.value).toBe(0.6);
    expect(getHistoryStateView().undo()).not.toBeNull();
    const undone = effectOperatorGraph(useTimelineStore.getState().clips[0].effects[0]);
    expect(undone.nodes.find(node => node.id === 'one')?.constants?.value).toBe(1);
    expect(undone.layout.one).toEqual({ x: 432, y: 210 });
    expect(undone.groups?.[0]).toMatchObject({ id: 'math', nodeIds: ['one'] });
    expect(getHistoryStateView().redo()).not.toBeNull();
    const redone = effectOperatorGraph(useTimelineStore.getState().clips[0].effects[0]);
    expect(redone.nodes.find(node => node.id === 'one')?.constants?.value).toBe(0.6);
    expect(redone.layout.one).toEqual({ x: 432, y: 210 });
    expect(redone.groups?.[0]).toMatchObject({ id: 'math', nodeIds: ['one'] });

    const serialized = createSerializableTimelineState(useTimelineStore.getState());
    expect(JSON.stringify(serialized)).not.toMatch(/videoElement|GPUTexture/);
    expect(serialized.clips[0].effects[0].params.operatorGraph).toBeUndefined();
    await useTimelineStore.getState().loadState(JSON.parse(JSON.stringify(serialized)));
    const restored = useTimelineStore.getState().clips.find(candidate => candidate.id === clip.id)!;
    const restoredPixel = evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(restored.effects[0]), restored.effects[0].params), pixel);
    expect(restoredPixel[0]).toBeCloseTo(0.4); expect(restoredPixel[1]).toBeCloseTo(0.2);
    expect(restoredPixel[2]).toBeCloseTo(-0.2); expect(restoredPixel[3]).toBe(0.75);
    expect(effectOperatorGraph(restored.effects[0]).layout.one).toEqual({ x: 432, y: 210 });
    expect(effectOperatorGraph(restored.effects[0]).groups?.[0]).toMatchObject({ id: 'math', nodeIds: ['one'] });
    expect(restored.effects[0].params.operatorGraph).toBeUndefined();
  });
});
