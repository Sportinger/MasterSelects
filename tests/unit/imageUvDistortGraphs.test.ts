import { describe, expect, it } from 'vitest';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, isImageGraphEffectType, isLocalImageEffectType } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultUvDistortGraph, type EditableUvDistortEffectType } from '../../src/services/operators/uvDistortEffectGraphs';
import { createLegacyBulgeGraph, createLegacyTwirlGraph, createLegacyWaveGraph } from '../../src/services/operators/legacyUvDistortEffectGraphs';
import { getEffect } from '../../src/effects';
import { discreteImage, evaluateImagePasses } from '../helpers/imageGraphPasses';

type UV = [number, number];
type Pixel = [number, number, number, number];
const source = ([u, v]: UV): Pixel => [u, v, u * .25 + v * .5, .13 + u * .7];
const RESOLUTION: UV = [1920, 1080];
const fract = (value: number) => value - Math.floor(value);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Independent CPU reference of the documented formulas (docs/Features/effects/bulge.md, twirl.md and wave.md). */
function shapeScale(shape: unknown, [width, height]: UV): UV {
  const short = Math.min(width, height);
  return shape === 'frame' ? [1, 1] : [width / short, height / short];
}
function radialReference(type: 'bulge' | 'twirl', uv: UV, params: Record<string, number | string>, resolution = RESOLUTION): UV {
  const scale = shapeScale(params.shape, resolution), center: UV = [Number(params.centerX), Number(params.centerY)];
  const p: UV = [(uv[0] - center[0]) * scale[0], (uv[1] - center[1]) * scale[1]];
  const r = Math.hypot(...p) / Math.max(Number(params.radius), 1e-4), amount = Number(params.amount);
  let moved: UV;
  if (type === 'bulge') {
    const weight = Math.max(1 - r * r, 0) ** 2;
    // Above 1 the centre magnification equals Amount: the read offset shrinks by 1 / Amount at r = 0.
    const beta = amount > 1 ? Math.log(amount) : Math.min(1 - amount, 1) * -0.95;
    const factor = Math.exp(-beta * weight);
    moved = [p[0] * factor, p[1] * factor];
  } else {
    const angle = amount * (1 - Math.min(r, 1)) ** 2;
    moved = [p[0] * Math.cos(angle) - p[1] * Math.sin(angle), p[0] * Math.sin(angle) + p[1] * Math.cos(angle)];
  }
  return [center[0] + moved[0] / scale[0], center[1] + moved[1] / scale[1]];
}
function waveReference(uv: UV, params: Record<string, number | string>, time: number): UV {
  const phase = Number(params.phase) * Math.PI / 180 + Math.PI * 2 * Number(params.speed) * time;
  const y = uv[1] + Math.sin(uv[0] * Number(params.frequencyX) * Math.PI * 2 + phase) * Number(params.amplitudeX);
  return [uv[0] + Math.sin(y * Number(params.frequencyY) * Math.PI * 2 + phase) * Number(params.amplitudeY), y];
}
function edgeReference(uv: UV, edges: unknown): UV {
  if (edges === 'mirror') return uv.map(value => 1 - Math.abs(fract(value * .5) * 2 - 1)) as UV;
  return [clamp01(uv[0]), clamp01(uv[1])];
}
function coverageReference(uv: UV, [width, height]: UV): number {
  return clamp01(Math.min(uv[0] * width, uv[1] * height, (1 - uv[0]) * width, (1 - uv[1]) * height) + .5);
}

const premultiply = ([r, g, b, a]: Pixel): Pixel => [r * a, g * a, b * a, a];

/**
 * Evaluates the two-pass plan (premultiplied source cache, then the distort) and records where
 * the distort pass reads the cache: the warped sample UV.
 */
function run(type: EditableUvDistortEffectType, params: Record<string, number | string>, uv: UV, options: { time?: number; resolution?: UV; graph?: ReturnType<typeof createDefaultUvDistortGraph> } = {}) {
  const effect = { type, params };
  const resolved = effectOperatorParams(effect);
  const plan = compileImageOperatorGraph(options.graph ?? createDefaultUvDistortGraph(type), resolved, effectOperatorCompileContext(effect));
  const resolution = options.resolution ?? RESOLUTION, sampled: UV[] = [], cached: Pixel[] = [];
  // The premultiplied source cache, then the final distort pass.
  expect(plan.passes?.map(pass => !!pass.outputResource)).toEqual([true, false]);
  const cache = plan.passes![0];
  const output = evaluateImageOperatorPlan(plan, source(uv), { uv, resolution, timelineTimeSeconds: options.time ?? 0, sampleImage: source,
    sampleResource: (id, at) => {
      expect(id).toBe(cache.outputResource);
      sampled.push(at);
      const texel = evaluateImageOperatorPlan(cache.program, source(at), { uv: at, resolution, sampleImage: source });
      cached.push(texel);
      return texel;
    } });
  return { sampled, cached, output, params: resolved as Record<string, number | string> };
}
const expectPixel = (actual: Pixel, expected: Pixel) => actual.forEach((value, channel) => expect(value).toBeCloseTo(expected[channel], 12));

describe('Wave, Twirl and Bulge & Pinch graphs', () => {
  it.each([
    ['bulge', { amount: 2.2, radius: .6, centerX: .48, centerY: .52 }, [.61, .42]],
    ['bulge', { amount: .3, radius: .7, centerX: .4, centerY: .55, shape: 'frame' }, [.31, .7]],
    ['twirl', { amount: -2.7, radius: .8, centerX: .44, centerY: .57 }, [.61, .42]],
    ['twirl', { amount: 4, radius: .5, centerX: .5, centerY: .5, shape: 'frame' }, [.55, .45]],
  ] as const)('%s matches an independent reference in shape space and samples once (%j)', (type, overrides, uv) => {
    const { sampled, cached, output, params } = run(type, { ...overrides }, [...uv] as UV);
    const expected = edgeReference(radialReference(type, [...uv] as UV, params), params.edges);
    expect(sampled).toHaveLength(1);
    expect(sampled[0][0]).toBeCloseTo(expected[0], 12); expect(sampled[0][1]).toBeCloseTo(expected[1], 12);
    // The cache holds premultiplied colour; the output is straight again.
    expectPixel(cached[0], premultiply(source(sampled[0])));
    expectPixel(output, source(sampled[0]));
  });

  it('keeps circles round on a wide frame and stretches them only with Shape: Stretch to Frame', () => {
    // A point one radius to the right and one radius above the centre must sit on the same rim.
    const params = { amount: 3, radius: .3, centerX: .5, centerY: .5 };
    const right: UV = [.5 + .3 * 1080 / 1920 * .5, .5], up: UV = [.5, .5 - .3 * .5];
    const offset = (uv: UV, sampled: UV) => Math.hypot((sampled[0] - .5) * 1920 / 1080, sampled[1] - .5) / Math.hypot((uv[0] - .5) * 1920 / 1080, uv[1] - .5);
    const ratioRight = offset(right, run('bulge', params, right).sampled[0]), ratioUp = offset(up, run('bulge', params, up).sampled[0]);
    expect(ratioRight).toBeCloseTo(ratioUp, 12);
    const stretched = { ...params, shape: 'frame' };
    expect(offset(right, run('bulge', stretched, right).sampled[0])).not.toBeCloseTo(offset(up, run('bulge', stretched, up).sampled[0]), 3);
  });

  it('bends Bulge smoothly at the rim and never folds a pinch back on itself, whatever amount arrives', () => {
    for (const amount of [-1e6, -3, 0, .1, .5, 1, 1.6, 3, 40]) {
      let previous = -1;
      for (let step = 1; step <= 400; step++) {
        const distance = step / 400 * .6, uv: UV = [.5 + distance * 1080 / 1920, .5];
        const sampledDistance = (run('bulge', { amount, radius: .5, edges: 'clamp' }, uv).sampled[0][0] - .5) * 1920 / 1080;
        expect(Number.isFinite(sampledDistance)).toBe(true);
        expect(sampledDistance).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = sampledDistance;
        // Outside the radius nothing moves; just inside it moves only by a second-order amount.
        if (distance >= .5) expect(sampledDistance).toBeCloseTo(distance, 12);
      }
      if (amount < -1 || amount > 3) continue;
      const nearRim: UV = [.5 + .499 * 1080 / 1920, .5];
      expect(Math.abs((run('bulge', { amount, radius: .5 }, nearRim).sampled[0][0] - .5) * 1920 / 1080 - .499)).toBeLessThan(1e-4);
    }
  });

  it('magnifies the centre of a bulge exactly Amount times', () => {
    for (const amount of [1.25, 2, 2.5, 3, 8]) {
      const offset = 1e-5, uv: UV = [.5 + offset, .5];
      const sampled = run('bulge', { amount, radius: .5 }, uv).sampled[0][0] - .5;
      expect(offset / sampled).toBeCloseTo(amount, 6);
    }
  });

  it('treats a zero or negative radius as no area instead of producing NaN', () => {
    for (const type of ['bulge', 'twirl'] as const) for (const radius of [0, -2, 1e-12]) {
      const uv: UV = [.3, .7], { sampled, output } = run(type, { amount: type === 'bulge' ? 3 : 8, radius }, uv);
      expect(sampled[0][0]).toBeCloseTo(.3, 12); expect(sampled[0][1]).toBeCloseTo(.7, 12);
      expect(output.every(Number.isFinite)).toBe(true);
    }
    expect((getEffect('bulge') as { paramWarnings: (p: Record<string, number>) => string[] }).paramWarnings({ radius: 0, amount: -1 })).toHaveLength(2);
    expect((getEffect('twirl') as { paramWarnings: (p: Record<string, number>) => string[] }).paramWarnings({ radius: .5 })).toEqual([]);
  });

  it('Wave matches its reference, travels with Speed over time and stays finite for extreme values', () => {
    const params = { amplitudeX: .071, amplitudeY: .043, frequencyX: 3.5, frequencyY: 7.25, speed: .75, phase: 30, edges: 'clamp' };
    for (const time of [0, .4, 2.5]) {
      const uv: UV = [.61, .42], { sampled } = run('wave', params, uv, { time });
      const expected = edgeReference(waveReference(uv, params, time), 'clamp');
      expect(sampled[0][0]).toBeCloseTo(expected[0], 12); expect(sampled[0][1]).toBeCloseTo(expected[1], 12);
    }
    expect(run('wave', params, [.61, .42], { time: 0 }).sampled[0]).not.toEqual(run('wave', params, [.61, .42], { time: .4 }).sampled[0]);
    const extreme = run('wave', { amplitudeX: 1e6, amplitudeY: -1e6, frequencyX: -40, frequencyY: 0, speed: -9, phase: -720 }, [.2, .9], { time: 3 });
    expect(extreme.sampled[0].every(value => value >= 0 && value <= 1)).toBe(true);
    expect(extreme.output.every(Number.isFinite)).toBe(true);
  });

  it('reproduces the original Twirl and Wave exactly with Stretch to Frame, Clamp, no Speed and no Phase', () => {
    const legacy = (graph: ReturnType<typeof createLegacyTwirlGraph>, params: Record<string, number>, uv: UV) => {
      const sampled: UV[] = [];
      evaluateImageOperatorPlan(compileImageOperatorGraph(graph, params), source(uv), { uv, sampleImage: at => { sampled.push(at); return source(at); } });
      return [clamp01(sampled[0][0]), clamp01(sampled[0][1])];
    };
    for (const uv of [[.61, .42], [.05, .93], [.5, .5]] as UV[]) {
      const twirl = { amount: -6.5, radius: .8, centerX: .44, centerY: .57 };
      const current = run('twirl', { ...twirl, shape: 'frame', edges: 'clamp' }, uv).sampled[0];
      legacy(createLegacyTwirlGraph(), twirl, uv).forEach((value, axis) => expect(current[axis]).toBeCloseTo(value, 14));
      const wave = { amplitudeX: .09, amplitudeY: .07, frequencyX: 5, frequencyY: 3 };
      const currentWave = run('wave', { ...wave, speed: 0, phase: 0, edges: 'clamp' }, uv, { time: 7 }).sampled[0];
      legacy(createLegacyWaveGraph(), wave, uv).forEach((value, axis) => expect(currentWave[axis]).toBeCloseTo(value, 14));
    }
    // The original Bulge stays recognizable as its own recipe; its curve was deliberately replaced.
    expect(createLegacyBulgeGraph().nodes.some(node => node.operator === 'math.power.scalar')).toBe(true);
  });

  it('mirrors, clamps or clears samples that leave the frame; Transparent lowers alpha only', () => {
    const params = { amplitudeX: .2, amplitudeY: 0, frequencyX: 1, frequencyY: 1, speed: 0, phase: 0 };
    const uv: UV = [.25, .95], raw = waveReference(uv, { ...params }, 0);
    expect(raw[1]).toBeGreaterThan(1);
    const mirror = run('wave', { ...params, edges: 'mirror' }, uv), clamp = run('wave', { ...params, edges: 'clamp' }, uv);
    expect(mirror.sampled[0][1]).toBeCloseTo(2 - raw[1], 12); expect(clamp.sampled[0][1]).toBe(1);
    const transparent = run('wave', { ...params, edges: 'transparent' }, uv);
    expect(coverageReference(raw, RESOLUTION)).toBe(0);
    expect(transparent.output).toEqual([0, 0, 0, 0]);
    // On the frame border the sample is half covered: alpha halves, the colour stays (no dark rim).
    const still = { amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1, speed: 0, phase: 0, edges: 'transparent' };
    const border: UV = [.37, 1], half = run('wave', still, border), expected = source(border);
    expect(coverageReference(border, RESOLUTION)).toBe(.5);
    expectPixel(half.output, [expected[0], expected[1], expected[2], expected[3] * .5]);
    // Half a pixel inside the frame keeps full coverage; the border pixel is half covered.
    expect(coverageReference([.5, 1 - .5 / 1080], RESOLUTION)).toBe(1);
    expect(coverageReference([.5, 1], RESOLUTION)).toBe(.5);
  });

  it.each(['wave', 'twirl', 'bulge'] as const)('%s is owner-backed, a cache plus one distort pass, bounded and rewires to source UV', type => {
    const effect = { type, params: {} }, graph = effectOperatorGraph(effect), params = effectOperatorParams(effect);
    expect(isImageGraphEffectType(type)).toBe(true); expect(isLocalImageEffectType(type)).toBe(false);
    expect(graph.nodes.length).toBeLessThanOrEqual(90);
    const plan = compileImageOperatorGraph(graph, params, effectOperatorCompileContext(effect)); expect(plan.passes).toHaveLength(2);
    const rewired = structuredClone(createDefaultUvDistortGraph(type)), uvEdge = rewired.edges.find(item => item.to === 'sample' && item.input === 'uv')!;
    uvEdge.from = 'uv'; uvEdge.output = 'uv';
    const uv: UV = [.31, .67];
    expect(run(type, {}, uv, { graph: rewired }).sampled[0]).toEqual(uv);
  });

  it('filters premultiplied texels at a cut-out edge, so a magnified edge keeps its colour', () => {
    // Opaque red texels next to transparent black ones: the straight bilinear mix would give dark red.
    const texels = (x: number): Pixel => x < 2 ? [1, 0, 0, 1] : [0, 0, 0, 0];
    const still = { amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1, speed: 0, phase: 0, edges: 'clamp' };
    const effect = { type: 'wave', params: still };
    const plan = compileImageOperatorGraph(createDefaultUvDistortGraph('wave'), effectOperatorParams(effect), effectOperatorCompileContext(effect));
    for (const [u, coverage] of [[.5, .5], [.4375, .75], [.5625, .25]] as const) {
      const pixel = evaluateImagePasses(plan, [u, .5], [4, 1], discreteImage(4, 1, x => texels(x)), { filterResources: true, float16: true, timelineTimeSeconds: 0 });
      // Independent reference: bilinear weights of the two texel centres around u, on premultiplied texels.
      expect(pixel[3]).toBeCloseTo(coverage, 3);
      expect(pixel[0]).toBeCloseTo(1, 3); expect(pixel[1]).toBe(0); expect(pixel[2]).toBe(0);
    }
  });
});
