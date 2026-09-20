import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { POSTERIZE_PARAMS, THRESHOLD_PARAMS } from '../../src/effects/stylize/pointwiseParams';
import { createDefaultPointwiseEffectGraph } from '../../src/services/operators/pointwiseEffectGraphs';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: 'threshold' | 'posterize', params = getDefaultParams(type)): Effect =>
  ({ id: `${type}-fx`, name: type, type, enabled: true, params });
const run = (type: 'threshold' | 'posterize', params: Record<string, unknown>, pixel: [number, number, number, number]) =>
  evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultPointwiseEffectGraph(type), params), pixel);

describe('pointwise effect graph ownership', () => {
  it('shares the exact legacy schemas and preserves them for graph-bound values', () => {
    expect(getEffect('threshold')?.params).toBe(THRESHOLD_PARAMS);
    expect(getEffect('posterize')?.params).toBe(POSTERIZE_PARAMS);
    expect(THRESHOLD_PARAMS.level).toMatchObject({ default: 0.5, min: 0, max: 1, step: 0.01, animatable: true });
    expect(POSTERIZE_PARAMS.levels).toMatchObject({ default: 6, min: 2, max: 32, step: 1, animatable: true });
  });

  it('uses strict Rec.709 threshold comparison and keeps alpha outside the math', () => {
    expect(run('threshold', { level: 0.5 }, [0.5, 0.5, 0.5, 0.35])).toEqual([0, 0, 0, 0.35]);
    expect(run('threshold', { level: 0.5 }, [0.5001, 0.5001, 0.5001, 0.35])).toEqual([1, 1, 1, 0.35]);
    const graph = createDefaultPointwiseEffectGraph('threshold');
    expect(graph.nodes.map(node => node.operator)).toContain('color.luminance-rec709.rgb');
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'split', output: 'alpha', to: 'combine', input: 'alpha' }));
  });

  it('matches posterize floor/divide semantics without a final clamp', () => {
    const result = run('posterize', { levels: 6 }, [1, 0.5, 0, 0.35]);
    expect(result).toEqual([1.2, 0.6, 0, 0.35]);
    const graph = createDefaultPointwiseEffectGraph('posterize');
    expect(graph.nodes.some(node => node.operator === 'math.clamp.rgb')).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'divide', output: 'value', to: 'combine', input: 'rgb' }));
  });

  it.each(['threshold', 'posterize'] as const)('derives %s params{} defaults and round-trips its canonical graph', type => {
    const legacy = effect(type, {}), graph = effectOperatorGraph(legacy);
    expect(effectOperatorParams(legacy)).toMatchObject(getDefaultParams(type));
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    expect(effectOperatorGraph(JSON.parse(JSON.stringify(canonical)) as Effect)).toEqual(graph);
  });

  it('executes rewired threshold branches and retains the stable posterize binding', () => {
    const threshold = createDefaultPointwiseEffectGraph('threshold');
    threshold.edges.find(edge => edge.to === 'select' && edge.input === 'falseValue')!.from = 'white';
    threshold.edges.find(edge => edge.to === 'select' && edge.input === 'trueValue')!.from = 'black';
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(threshold, { level: 0.5 }), [0.2, 0.2, 0.2, 0.35])).toEqual([1, 1, 1, 0.35]);

    const canonical = migratePersistedEffectOperatorGraph(effect('posterize'));
    const clip = createMockClip({ id: 'posterize-clip', effects: [canonical] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    setOperatorParameter(clip.id, canonical.id, 'levels', 'value', 12);
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.levels).toBe(12);
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'levels')).toMatchObject({ bindings: { value: 'levels' } });
    expect(() => setOperatorParameter(clip.id, canonical.id, 'levels', 'value', 33)).toThrow('outside its supported range');
  });
});
