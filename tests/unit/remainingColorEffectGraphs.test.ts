import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { EXPOSURE_PARAMS, HUE_SHIFT_PARAMS, LEVELS_PARAMS, TEMPERATURE_PARAMS, VIBRANCE_PARAMS } from '../../src/effects/color/remainingColorParams';
import { createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const TYPES = ['exposure', 'levels', 'hue-shift', 'temperature', 'vibrance'] as const;
const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: typeof TYPES[number], params = getDefaultParams(type)): Effect =>
  ({ id: `${type}-fx`, name: type, type, enabled: true, params });
const evaluate = (type: EditableColorEffectType, params: Record<string, unknown>, pixel: [number, number, number, number]) =>
  evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultColorEffectGraph(type), params), pixel);

describe('remaining editable color effect graphs', () => {
  it('shares the exact legacy parameter schemas with graph metadata', () => {
    expect(getEffect('exposure')?.params).toBe(EXPOSURE_PARAMS);
    expect(getEffect('levels')?.params).toBe(LEVELS_PARAMS);
    expect(getEffect('hue-shift')?.params).toBe(HUE_SHIFT_PARAMS);
    expect(getEffect('temperature')?.params).toBe(TEMPERATURE_PARAMS);
    expect(getEffect('vibrance')?.params).toBe(VIBRANCE_PARAMS);
    expect(EXPOSURE_PARAMS).toMatchObject({ exposure: { default: 0, min: -3, max: 3, step: 0.1 }, gamma: { default: 1, min: 0.2, max: 3 } });
    expect(LEVELS_PARAMS).toMatchObject({ inputBlack: { default: 0, min: 0, max: 1 }, gamma: { default: 1, min: 0.1, max: 3 } });
  });

  it.each(TYPES)('%s derives missing legacy params from its schema and preserves alpha', type => {
    const legacy = effect(type, {}), graph = effectOperatorGraph(legacy), params = effectOperatorParams(legacy);
    expect(params).toMatchObject(getDefaultParams(type));
    const result = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, params), [0.2, 0.4, 0.8, 0.35]);
    expect(result.slice(0, 3)).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]));
    result.forEach((value, index) => expect(value).toBeCloseTo([0.2, 0.4, 0.8, 0.35][index], 4));
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'split', output: 'alpha', to: 'combine', input: 'alpha' }));
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    expect(effectOperatorGraph(JSON.parse(JSON.stringify(canonical)) as Effect)).toEqual(graph);
  });

  it('matches the five legacy shader formulas with changed parameters', () => {
    const pixel: [number, number, number, number] = [0.2, 0.4, 0.8, 0.35];
    expect(evaluate('exposure', { exposure: 1, offset: 0.1, gamma: 1 }, pixel)).toEqual([0.5, 0.9, 1, 0.35]);
    const levels = evaluate('levels', { inputBlack: 0.2, inputWhite: 0.8, gamma: 1, outputBlack: 0.1, outputWhite: 0.9 }, pixel);
    [0.1, 0.3666667, 0.9, 0.35].forEach((value, index) => expect(levels[index]).toBeCloseTo(value, 5));
    const hue = evaluate('hue-shift', { shift: 0.5 }, [1, 0, 0, 0.35]);
    [0, 1, 1, 0.35].forEach((value, index) => expect(hue[index]).toBeCloseTo(value, 4));
    const temperature = evaluate('temperature', { temperature: 1, tint: 1 }, pixel);
    [0.35, 0.3, 0.75, 0.35].forEach((value, index) => expect(temperature[index]).toBeCloseTo(value, 5));
    const sat = (0.8 - 0.2) / (0.8 + 0.001), factor = 1 + (1 - sat), gray = 0.2 * 0.299 + 0.4 * 0.587 + 0.8 * 0.114;
    const vibrance = evaluate('vibrance', { amount: 1 }, pixel);
    [gray + (0.2 - gray) * factor, gray + (0.4 - gray) * factor, gray + (0.8 - gray) * factor, 0.35]
      .forEach((value, index) => expect(vibrance[index]).toBeCloseTo(value, 5));
  });

  it('executes changed graph wiring and persists stable bound parameter edits', () => {
    const graph = createDefaultColorEffectGraph('levels');
    graph.edges.find(edge => edge.to === 'output-mix' && edge.input === 'a')!.from = 'outputWhite-rgb';
    graph.edges.find(edge => edge.to === 'output-mix' && edge.input === 'b')!.from = 'outputBlack-rgb';
    const rewired = evaluateImageOperatorPlan(compileImageOperatorGraph(graph, getDefaultParams('levels')), [0.2, 0.4, 0.8, 0.35]);
    [0.8, 0.6, 0.2, 0.35].forEach((value, index) => expect(rewired[index]).toBeCloseTo(value, 5));

    const canonical = migratePersistedEffectOperatorGraph(effect('temperature'));
    const clip = createMockClip({ id: 'temperature-clip', effects: [canonical] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    setOperatorParameter(clip.id, canonical.id, 'temperature', 'value', 0.6);
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.temperature).toBe(0.6);
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'temperature')).toMatchObject({ bindings: { value: 'temperature' } });
    expect(() => setOperatorParameter(clip.id, canonical.id, 'temperature', 'value', 1.1)).toThrow('outside its supported range');
  });
});
