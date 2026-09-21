import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import { createDefaultDirectionalBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
import { effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { createMockClip } from '../helpers/mockData';
import type { Effect } from '../../src/types/effects';

const TYPES = ['motion-blur', 'radial-blur', 'zoom-blur'] as const;
const expectedBindings = { 'motion-blur': ['amount', 'angle', 'samples'], 'radial-blur': ['amount', 'centerX', 'centerY', 'samples'],
  'zoom-blur': ['amount', 'centerX', 'centerY', 'samples'] } as const;
const sample = ([u, v]: [number, number]): [number, number, number, number] => [u, v, .25, .75];
const weighted = (values: Array<{ pixel: number[]; weight: number }>) => values[0].pixel.map((_, channel) => {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  return values.reduce((sum, value) => sum + value.pixel[channel] * value.weight, 0) / total;
});

function legacy(type: typeof TYPES[number], params: Record<string, number>, uv: [number, number]) {
  const max = type === 'motion-blur' ? 128 : 256, count = Math.trunc(Math.min(max, Math.max(4, params.samples)));
  const center: [number, number] = [params.centerX ?? .5, params.centerY ?? .5], dir: [number, number] = [uv[0] - center[0], uv[1] - center[1]];
  const dist = Math.hypot(...dir), values = Array.from({ length: count }, (_, index) => {
    const normalized = count === 1 ? 0 : index / (count - 1);
    if (type === 'motion-blur') { const t = (normalized - .5) * 2, direction = [Math.cos(params.angle), Math.sin(params.angle)];
      const raw: [number, number] = [uv[0] + direction[0] * t * params.amount, uv[1] + direction[1] * t * params.amount];
      const mirror = (value: number) => { const wrapped = value - Math.floor(value * .5) * 2; return wrapped > 1 ? 2 - wrapped : wrapped; };
      return { pixel: sample([mirror(raw[0]), mirror(raw[1])]), weight: Math.exp((-t) * t * 2) }; }
    const factor = type === 'radial-blur' ? 1 - params.amount * .2 * normalized * dist : 1 + params.amount * .5 * normalized;
    return { pixel: sample([center[0] + dir[0] * factor, center[1] + dir[1] * factor]), weight: type === 'radial-blur' ? 1 - normalized * .5 : 1 };
  });
  return weighted(values);
}

describe('directional blur image graphs', () => {
  it.each(TYPES)('%s is a compact fullscreen graph with stable owner defaults and structural keys', type => {
    const graph = createDefaultDirectionalBlurGraph(type), bindings = graph.nodes.flatMap(node => Object.values(node.bindings));
    expect(validateEffectGraph(graph)).toEqual([]); expect(graph.nodes.length).toBeLessThanOrEqual(64);
    expect(bindings.toSorted()).toEqual([...expectedBindings[type]].toSorted());
    expect(isImageGraphEffectType(type)).toBe(true); expect(isLocalImageEffectType(type)).toBe(false);
    expect(effectOperatorGraph({ type, params: {} }).nodes.map(node => node.id)).toEqual(graph.nodes.map(node => node.id));
    const defaults = effectOperatorParams({ type, params: {} });
    expect(defaults).toMatchObject(Object.fromEntries(expectedBindings[type].map(id => [id, getEffect(type)!.params[id].default])));
    expect(compileImageOperatorGraph(graph, defaults).key).toBe(compileImageOperatorGraph(graph, { ...defaults, amount: 0.123 }).key);
  });

  it.each([
    ['motion-blur', { amount: .12, angle: .7, samples: 5.9 }],
    ['radial-blur', { amount: .6, centerX: .35, centerY: .65, samples: 6.8 }],
    ['zoom-blur', { amount: .4, centerX: .4, centerY: .55, samples: 7.2 }],
  ] as const)('%s matches the independently calculated legacy sampling formula', (type, params) => {
    const uv: [number, number] = [.61, .43], plan = compileImageOperatorGraph(createDefaultDirectionalBlurGraph(type), params);
    const actual = evaluateImageOperatorPlan(plan, sample(uv), { uv, sampleImage: sample });
    const expected = legacy(type, { ...params }, uv);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
  });

  it('truncates/clamps count and preserves strict bypass thresholds', () => {
    const cases = [
      ['motion-blur', .001, .0009, 200, 128], ['radial-blur', .01, .009, 5.9, 5],
    ] as const;
    for (const [type, equal, below, samples, expectedSamples] of cases) {
      const graph = createDefaultDirectionalBlurGraph(type), base = { amount: below, angle: 0, centerX: .5, centerY: .5, samples };
      let calls = 0; evaluateImageOperatorPlan(compileImageOperatorGraph(graph, base), sample([.5, .5]), { uv: [.5, .5], sampleImage: uv => { calls++; return sample(uv); } });
      expect(calls).toBe(0);
      evaluateImageOperatorPlan(compileImageOperatorGraph(graph, { ...base, amount: equal }), sample([.5, .5]), { uv: [.5, .5], sampleImage: uv => { calls++; return sample(uv); } });
      expect(calls).toBe(expectedSamples);
    }
  });

  it('labels sequence index values as sample-scoped instead of inventing zero', () => {
    const effect: Effect = { id: 'motion', type: 'motion-blur', name: 'Motion Blur', enabled: true, params: {}, operatorGraph: createDefaultDirectionalBlurGraph('motion-blur') };
    const clip = createMockClip({ id: 'motion-clip', effects: [effect] }), node = buildEffectOperatorGraph(clip, effect).nodes.find(item => item.id === 'sequence')!;
    const frame = imageOperatorValuePreview({ key: 'sequence', revision: '1', clipId: clip.id, node, time: 0, width: 100, height: 100, interval: 16, priority: 1 }, clip, effect);
    expect(frame).toMatchObject({ status: 'missing', label: 'Sequence scope only', drawing: { kind: 'text', lines: ['Varies per sequence sample'] } });
  });

  it.each([['motion-blur', 128], ['radial-blur', 256], ['zoom-blur', 256]] as const)(
    'keeps the %s maximum-samples literal inside its editable range', (type, maximum) => {
      const effect: Effect = { id: type, type, name: type, enabled: true, params: {}, operatorGraph: createDefaultDirectionalBlurGraph(type) };
      const clip = createMockClip({ id: `${type}-clip`, effects: [effect] });
      const node = buildEffectOperatorGraph(clip, effect).nodes.find(item => item.id === 'maximum-samples')!;
      const frame = imageOperatorValuePreview({ key: `${type}-maximum`, revision: '1', clipId: clip.id, node, time: 0,
        width: 100, height: 100, interval: 16, priority: 1 }, clip, effect);
      expect(frame?.controls?.[0]).toMatchObject({ value: maximum, min: -30, max: maximum });
      const samples = buildEffectOperatorGraph(clip, effect).nodes.find(item => item.id === 'samples')!;
      const bound = imageOperatorValuePreview({ key: `${type}-samples`, revision: '1', clipId: clip.id, node: samples, time: 0,
        width: 100, height: 100, interval: 16, priority: 1 }, clip, effect);
      expect(bound?.controls?.[0]).toMatchObject({ min: 4, max: maximum, defaultValue: getEffect(type)!.params.samples.default });
    },
  );
});
