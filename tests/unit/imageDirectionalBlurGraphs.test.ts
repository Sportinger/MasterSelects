import { describe, expect, it } from 'vitest';
import { getEffect } from '../../src/effects';
import {
  directionalBlurPlan, directionalCoarseTaps, directionalFineTaps, mirrorRepeat, transformDirectionalPixel, type DirectionalBlurType,
} from '../../src/effects/blur/blurSampling';
import { createDefaultDirectionalBlurGraph, createEvenTapDirectionalBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
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
    const pixel: [number, number] = [at[0] * resolution[0], at[1] * resolution[1]], sum: Pixel = [0, 0, 0, 0];
    let total = 0;
    for (const tap of directionalFineTaps(plan, pixel)) {
      const color = source(toUv(transformDirectionalPixel(plan, pixel, tap.u)));
      [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]].forEach((value, channel) => { sum[channel] += value * tap.weight; });
      total += tap.weight;
    }
    return sum.map(value => value / total) as Pixel;
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
  it.each(TYPES)('%s is a valid three-pass graph (premultiplied source, stage A, stage B) with stable owner bindings and runtime parameters', type => {
    const graph = createDefaultDirectionalBlurGraph(type), bindings = graph.nodes.flatMap(node => Object.values(node.bindings));
    expect(validateEffectGraph(graph)).toEqual([]); expect(graph.nodes.length).toBeLessThanOrEqual(150);
    expect(bindings.toSorted()).toEqual([...expectedBindings[type]].toSorted());
    expect(isImageGraphEffectType(type)).toBe(true); expect(isLocalImageEffectType(type)).toBe(false);
    expect(matchesEffectRecipe(effectOperatorGraph({ type, params: {} }), graph)).toBe(true);
    const defaults = effectOperatorParams({ type, params: {} });
    expect(defaults).toMatchObject(Object.fromEntries(expectedBindings[type].map(id => [id, getEffect(type)!.params[id].default])));
    const plan = compile(type, {});
    expect(plan.passes).toHaveLength(3);
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
    // (0.3, 0.13): clear of the synthetic source's blue wrap at 3u + v = 1, where any two taps would straddle a jump.
    const plan = compile(type, { amount: 0 }), uv: [number, number] = [0.3, 0.13], input = source(uv);
    evaluateImagePasses(plan, uv, [320, 180], source).forEach((value, channel) => expect(value).toBeCloseTo(input[channel], 5));
  });

  // Fine stripes about 3 px wide at 1080p: a sub-pixel change of the streak shows directly.
  const stripes = ([u, v]: [number, number]): Pixel => [0.5 + 0.5 * Math.sin(u * 1920 * 2.1 + v * 7), 0.5 + 0.5 * Math.sin(v * 1080 * 1.9 + u * 3),
    0.5 + 0.5 * Math.sin((u * 1920 + v * 1080) * 1.3), 1];
  const sweep = (graph: ReturnType<typeof createDefaultDirectionalBlurGraph>, type: DirectionalBlurType, extra: Record<string, unknown>, amounts: number[]) => {
    const pixels: Array<[number, number]> = [[0.21, 0.37], [0.83, 0.12], [0.55, 0.81], [0.512, 0.523], [0.47, 0.46]];
    const frames = amounts.map(amount => {
      const effect = { type, params: { ...extra, amount } };
      const plan = compileImageOperatorGraph(graph, effectOperatorParams(effect), effectOperatorCompileContext(effect));
      return pixels.flatMap(uv => evaluateImagePasses(plan, uv, [1920, 1080], stripes).slice(0, 3));
    });
    // A smooth ramp changes its rate of change only gradually; a jump at a count step shows as a
    // second difference as large as the jump itself. Ratio: largest second difference over the
    // typical (median) change between neighbouring frames.
    const changes = frames.slice(1).map((frame, index) => Math.max(...frame.map((value, channel) => Math.abs(value - frames[index][channel]))));
    const bends = frames.slice(2).map((frame, index) => Math.max(...frame.map((value, channel) => Math.abs(value - 2 * frames[index + 1][channel] + frames[index][channel]))));
    const largestStep = Math.max(...changes), median = changes.toSorted((a, b) => a - b)[Math.floor(changes.length / 2)];
    const jump = Math.max(...bends) / Math.max(median, 1e-6);
    return { jump, largestStep, median };
  };

  it.each([
    ['motion-blur', {}, Array.from({ length: 61 }, (_, index) => index * 0.00001)],
    ['radial-blur', { mode: 'spin' }, Array.from({ length: 61 }, (_, index) => index * 0.00005)],
    ['radial-blur', {}, Array.from({ length: 61 }, (_, index) => 0.9 + index * 0.002)],
    ['zoom-blur', {}, Array.from({ length: 61 }, (_, index) => index * 0.0005)],
  ] as const)('%s %j changes smoothly when its amount is animated from a standstill (the 3.2.7 recipe jumped at its tap-count steps)', (type, extra, amounts) => {
    const current = sweep(createDefaultDirectionalBlurGraph(type), type, extra, [...amounts]);
    expect(current.jump).toBeLessThan(1.5);
    // The 3.2.7 recipe bent by about ten typical frame changes at once (Zoom Blur's stayed smooth over this ramp).
    if (type !== 'zoom-blur') expect(sweep(createEvenTapDirectionalBlurGraph(type), type, extra, [...amounts]).jump).toBeGreaterThan(5);
  });

  it('blurs a little under one pixel of streak instead of passing the picture through', () => {
    for (const [type, extra, amount] of [['motion-blur', {}, 0.00005], ['radial-blur', { mode: 'spin' }, 0.0004]] as const) {
      const effect = { type, params: { ...extra, amount } }, uv: [number, number] = [0.83, 0.12];
      const blurred = evaluateImagePasses(compileImageOperatorGraph(createDefaultDirectionalBlurGraph(type), effectOperatorParams(effect), effectOperatorCompileContext(effect)), uv, [1920, 1080], stripes);
      const even = evaluateImagePasses(compileImageOperatorGraph(createEvenTapDirectionalBlurGraph(type), effectOperatorParams(effect), effectOperatorCompileContext(effect)), uv, [1920, 1080], stripes);
      expect(Math.max(...blurred.slice(0, 3).map((value, channel) => Math.abs(value - stripes(uv)[channel])))).toBeGreaterThan(1e-4);
      even.slice(0, 3).forEach((value, channel) => expect(value).toBeCloseTo(stripes(uv)[channel], 9));
    }
  });

  it('keeps motion streaks continuous: coarse boxes tile the range, fine taps stay within one pixel', () => {
    const plan = directionalBlurPlan('motion-blur', { amount: 0.3, angle: 0 }, 3840, 2160);
    const taps = directionalCoarseTaps(plan, [100, 100]), fine = directionalFineTaps(plan, [100, 100]);
    expect(plan.coarseTaps * plan.step).toBeCloseTo(2 * 0.3 * 3840, 6);
    // Coarse boxes cover the range: full boxes weigh 1, the partial last one its covered share.
    expect(taps.reduce((sum, tap) => sum + tap.weight / plan.taper((tap.u + 0.3 * 3840) / (2 * 0.3 * 3840)), 0)).toBeCloseTo(plan.coarseTaps, 4);
    const fineU = fine.map(tap => tap.u).toSorted((a, b) => a - b);
    for (let index = 1; index < fineU.length; index += 1) expect(fineU[index] - fineU[index - 1]).toBeLessThanOrEqual(1 + 1e-9);
    expect(fine.reduce((sum, tap) => sum + tap.weight, 0)).toBeCloseTo(plan.step, 4);
    expect(taps.length + fine.length).toBeLessThan(160);
  });

  it('measures motion on screen: the direction is an exact angle in pixels, the reach the legacy Length * |(cos W, sin H)|', () => {
    const plan = directionalBlurPlan('motion-blur', { amount: 0.1, angle: Math.PI / 4 }, 1920, 1080);
    const end = transformDirectionalPixel(plan, [0, 0], plan.range([0, 0]).start + plan.range([0, 0]).length);
    expect(end[1] / end[0]).toBeCloseTo(1, 9);
    expect(Math.hypot(...end)).toBeCloseTo(0.1 * Math.hypot(1920 * Math.SQRT1_2, 1080 * Math.SQRT1_2), 6);
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
