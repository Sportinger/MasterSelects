import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import {
  directionalBlurPlan, directionalCoarseTaps, directionalFineTaps, mirrorRepeat, transformDirectionalPixel, type DirectionalBlurType,
} from '../../src/effects/blur/blurSampling';
import { createDefaultDirectionalBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { createMockClip } from '../helpers/mockData';
import { evaluateImagePasses, type Pixel } from '../helpers/imageGraphPasses';
import type { Effect } from '../../src/types/effects';

const TYPES = ['motion-blur', 'radial-blur', 'zoom-blur'] as const;
const expectedBindings = { 'motion-blur': ['amount', 'angle'], 'radial-blur': ['amount', 'centerX', 'centerY', 'mode'],
  'zoom-blur': ['amount', 'centerX', 'centerY'] } as const;
const source = ([u, v]: [number, number]): Pixel => [0.5 + 0.45 * Math.sin(u * 31 + v * 3), 0.5 + 0.45 * Math.cos(v * 19), (u * 3 + v) % 1,
  Math.min(1, Math.max(0, 0.2 + Math.sin(u * 5 - v * 4)))];

function compile(type: DirectionalBlurType, params: Record<string, unknown>) {
  const effect = { type, params };
  return compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
}

/** Independent reference from the sampling contract: stage A evaluated exactly at every coarse tap. */
function reference(type: DirectionalBlurType, params: Record<string, unknown>, uv: [number, number], resolution: [number, number]): Pixel {
  const resolved = effectOperatorParams({ type, params });
  const plan = directionalBlurPlan(type, resolved, resolution[0], resolution[1]);
  const toUv = (pixel: [number, number]): [number, number] => {
    const raw: [number, number] = [pixel[0] / resolution[0], pixel[1] / resolution[1]];
    return type === 'motion-blur' ? [mirrorRepeat(raw[0]), mirrorRepeat(raw[1])] : raw;
  };
  const fine = (at: [number, number]): Pixel => {
    const pixel: [number, number] = [at[0] * resolution[0], at[1] * resolution[1]], count = directionalFineTaps(plan, pixel), sum: Pixel = [0, 0, 0, 0];
    for (let index = 0; index < count; index += 1) {
      const color = source(toUv(transformDirectionalPixel(plan, pixel, ((index + 0.5) / count - 0.5) * Math.max(plan.step, 1e-9))));
      [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]].forEach((value, channel) => { sum[channel] += value / count; });
    }
    return sum;
  };
  const pixel: [number, number] = [uv[0] * resolution[0], uv[1] * resolution[1]], sum: Pixel = [0, 0, 0, 0];
  let weight = 0;
  for (const tap of directionalCoarseTaps(plan, pixel)) {
    fine(toUv(transformDirectionalPixel(plan, pixel, tap.u))).forEach((value, channel) => { sum[channel] += value * tap.weight; });
    weight += tap.weight;
  }
  const average = sum.map(value => value / weight);
  return [...average.slice(0, 3).map(value => value / Math.max(average[3], 1e-6)), average[3]] as Pixel;
}

describe('directional blur image graphs', () => {
  it.each(TYPES)('%s is a valid two-pass graph with stable owner bindings and runtime parameters', type => {
    const graph = createDefaultDirectionalBlurGraph(type), bindings = graph.nodes.flatMap(node => Object.values(node.bindings));
    expect(validateEffectGraph(graph)).toEqual([]); expect(graph.nodes.length).toBeLessThanOrEqual(140);
    expect(bindings.toSorted()).toEqual([...expectedBindings[type]].toSorted());
    expect(isImageGraphEffectType(type)).toBe(true); expect(isLocalImageEffectType(type)).toBe(false);
    expect(matchesEffectRecipe(effectOperatorGraph({ type, params: {} }), graph)).toBe(true);
    const defaults = effectOperatorParams({ type, params: {} });
    expect(defaults).toMatchObject(Object.fromEntries(expectedBindings[type].map(id => [id, getEffect(type)!.params[id].default])));
    const plan = compile(type, {});
    expect(plan.passes).toHaveLength(2);
    expect(compile(type, { amount: 0.123 }).key).toBe(plan.key);
  });

  it.each([
    ['motion-blur', {}, [320, 180]], ['motion-blur', { amount: 0.12, angle: 0.7 }, [320, 180]], ['motion-blur', { amount: 0.3, angle: 2.2 }, [200, 300]],
    ['zoom-blur', {}, [320, 180]], ['zoom-blur', { amount: 1, centerX: 0.8, centerY: 0.1 }, [256, 256]],
    ['radial-blur', {}, [320, 180]], ['radial-blur', { amount: 2, centerX: 0.3, centerY: 0.7 }, [320, 180]],
    ['radial-blur', { mode: 'spin', amount: 0.5 }, [320, 180]], ['radial-blur', { mode: 'spin', amount: 2, centerX: 0.2, centerY: 0.6 }, [180, 320]],
  ] as const)('%s %j on %j matches the two-stage sampling contract on the CPU', (type, params, resolution) => {
    const plan = compile(type, params);
    for (const uv of [[0.61, 0.43], [0.03, 0.95], [0.5, 0.5]] as [number, number][]) {
      const actual = evaluateImagePasses(plan, uv, [...resolution], source), expected = reference(type, params, uv, [...resolution]);
      expected.forEach((value, channel) => expect(actual[channel], `${uv} channel ${channel}`).toBeCloseTo(value, 4));
    }
  });

  it.each(TYPES)('%s at amount 0 is the identity for visible pixels', type => {
    const plan = compile(type, { amount: 0 }), uv: [number, number] = [0.3, 0.1], input = source(uv);
    evaluateImagePasses(plan, uv, [320, 180], source).forEach((value, channel) => expect(value).toBeCloseTo(input[channel], 5));
  });

  it('keeps motion streaks continuous: coarse boxes tile the range, fine taps stay within one pixel', () => {
    const plan = directionalBlurPlan('motion-blur', { amount: 0.3, angle: 0 }, 3840, 2160);
    const taps = directionalCoarseTaps(plan, [100, 100]);
    expect(taps.length * plan.step).toBeCloseTo(2 * 0.3 * 3840, 6);
    expect(plan.step / directionalFineTaps(plan, [100, 100])).toBeLessThanOrEqual(1);
    expect(taps.length + directionalFineTaps(plan, [100, 100])).toBeLessThan(160);
  });

  it('measures motion on screen: the direction is an exact angle in pixels, the length a share of the width', () => {
    const plan = directionalBlurPlan('motion-blur', { amount: 0.1, angle: Math.PI / 4 }, 1920, 1080);
    const end = transformDirectionalPixel(plan, [0, 0], plan.range([0, 0]).start + plan.range([0, 0]).length);
    expect(end[1] / end[0]).toBeCloseTo(1, 9);
    expect(Math.hypot(...end)).toBeCloseTo(0.1 * 1920, 6);
  });

  it('ignores the retired samples parameter: same shader and same pixels', () => {
    for (const type of TYPES) {
      expect(getEffect(type)!.params.samples).toMatchObject({ hidden: true, deprecated: expect.stringContaining('no effect') });
      const low = compile(type, { amount: 0.2, samples: 4 }), high = compile(type, { amount: 0.2, samples: 200 });
      expect(low.key).toBe(high.key);
      expect(evaluateImagePasses(low, [0.4, 0.6], [160, 90], source)).toEqual(evaluateImagePasses(high, [0.4, 0.6], [160, 90], source));
    }
  });

  it('mirrors only Motion Blur at the frame edge; Zoom and Radial keep the sampler clamp', () => {
    for (const type of TYPES) {
      const mirrored = createDefaultDirectionalBlurGraph(type).nodes.filter(node => node.operator === 'coordinates.mirror-repeat.vec2');
      expect(mirrored.length).toBe(type === 'motion-blur' ? 2 : 0);
    }
  });

  it('labels sequence index values as sample-scoped instead of inventing zero', () => {
    const effect: Effect = { id: 'motion', type: 'motion-blur', name: 'Motion Blur', enabled: true, params: {}, operatorGraph: createDefaultDirectionalBlurGraph('motion-blur') };
    const clip = createMockClip({ id: 'motion-clip', effects: [effect] }), node = buildEffectOperatorGraph(clip, effect).nodes.find(item => item.id === 'coarse-sequence')!;
    const frame = imageOperatorValuePreview({ key: 'coarse-sequence', revision: '1', clipId: clip.id, node, time: 0, width: 100, height: 100, interval: 16, priority: 1 }, clip, effect);
    expect(frame).toMatchObject({ status: 'missing', label: 'Sequence scope only', drawing: { kind: 'text', lines: ['Varies per sequence sample'] } });
  });
});
