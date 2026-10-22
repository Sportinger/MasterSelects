import { describe, expect, it } from 'vitest';
import { getEffect, getDefaultParams } from '../../src/effects';
import {
  SEPARABLE_MAX_PAIRS_PER_SIDE, blurBudgetNotes, blurPixelScale, directionalBlurAmount, directionalBlurPlan, directionalCoarseTaps,
  radialBlurMode, separableBlurTaps,
} from '../../src/effects/blur/blurSampling';
import { catalogText } from '../../src/services/nodeGraph/catalogText';
import { upgradeBlurGraph } from '../../src/services/operators/blurGraphUpgrade';
import { createDefaultBoxBlurGraph, createDefaultGaussianBlurGraph } from '../../src/services/operators/blurEffectGraphs';
import { createDefaultMotionBlurGraph, createDefaultRadialBlurGraph, createDefaultZoomBlurGraph, createEvenTapDirectionalBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
import { createLegacyBoxBlurGraph, createLegacyGaussianBlurGraph } from '../../src/services/operators/legacyBlurEffectGraphs';
import { createLegacyMotionBlurGraph, createLegacyRadialBlurGraph, createLegacyZoomBlurGraph } from '../../src/services/operators/legacyDirectionalBlurEffectGraphs';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

/** Dense discrete kernel (one tap per texel) as the ground truth for the pair-merged taps. */
function denseMoments(kind: 'gaussian' | 'box', radius: number, height: number) {
  const { radiusPx, sigma, pairs } = separableBlurTaps(kind, radius, height * 2, height);
  const weight = (x: number) => kind === 'gaussian' ? Math.exp(-(x * x) / (2 * sigma * sigma)) : Math.min(1, Math.max(0, radiusPx + 1 - Math.abs(x)));
  // The kernel support ends at the last pair (at least 3 sigma for Gaussian, past the box edge for Box).
  const reach = 2 * pairs;
  let sum = 0, second = 0;
  for (let x = -reach; x <= reach; x += 1) { sum += weight(x); second += weight(x) * x * x; }
  return { sum, variance: second / sum };
}

describe('blur sampling contract', () => {
  it('measures radius in pixels of a 1080p frame by its shorter side', () => {
    expect(blurPixelScale(1920, 1080)).toBe(1);
    expect(blurPixelScale(1080, 1920)).toBe(1);
    expect(blurPixelScale(3840, 2160)).toBe(2);
    expect(blurPixelScale(960, 540)).toBe(0.5);
  });

  it.each([
    ['gaussian', 10], ['gaussian', 3.3], ['gaussian', 50], ['box', 5], ['box', 2.6], ['box', 50],
  ] as const)('pair-merged %s taps reproduce the dense kernel at radius %s', (kind, radius) => {
    const { taps, stride } = separableBlurTaps(kind, radius, 1920, 1080);
    expect(stride).toBe(1);
    const sum = taps.reduce((total, tap) => total + tap.weight, 0);
    const variance = taps.reduce((total, tap) => total + tap.weight * tap.offset * tap.offset, 0) / sum;
    const dense = denseMoments(kind, radius, 1080);
    expect(sum).toBeCloseTo(dense.sum, 9);
    // Merging two texels into one linear tap is exact for the mean; the variance gains a+b-ab type terms below 1/4 texel^2.
    expect(Math.abs(variance - dense.variance)).toBeLessThan(0.25);
    expect(taps.reduce((total, tap) => total + tap.weight * tap.offset, 0)).toBeCloseTo(0, 9);
  });

  it('keeps legacy Box Blur sizes and animates fractional radii smoothly', () => {
    // Legacy: a (2r+1)^2 unit box for integer r; the separable taps cover exactly 2r+1 texels.
    expect(separableBlurTaps('box', 5, 1920, 1080).taps.reduce((total, tap) => total + tap.weight, 0)).toBeCloseTo(11, 9);
    const sizes = [5, 5.25, 5.5, 5.75, 6].map(radius => separableBlurTaps('box', radius, 1920, 1080).taps.reduce((total, tap) => total + tap.weight, 0));
    sizes.slice(1).forEach((size, index) => expect(size - sizes[index]).toBeCloseTo(0.5, 9));
  });

  it('matches the legacy Gaussian default strength at 1080p and stays linear in radius', () => {
    // Legacy grid (radius 10, samples 5) spread 11 taps two pixels apart: an effective standard deviation of about 5.27 px.
    expect(Math.sqrt(denseMoments('gaussian', 10, 1080).variance)).toBeCloseTo(5, 1);
    expect(Math.sqrt(denseMoments('gaussian', 40, 1080).variance)).toBeCloseTo(20, 0);
  });

  it('spreads pairs instead of truncating when the kernel exceeds the tap budget', () => {
    const plan = separableBlurTaps('gaussian', 50, 8192, 4320);
    expect(plan.clamped).toBe(true);
    expect(plan.pairs).toBe(SEPARABLE_MAX_PAIRS_PER_SIDE);
    expect(plan.stride).toBeGreaterThan(1);
    expect(Math.max(...plan.taps.map(tap => Math.abs(tap.offset)))).toBeGreaterThan(plan.reach * 0.95);
  });

  it('defaults Radial Blur to the legacy zoom look and spins only on request', () => {
    expect(radialBlurMode(undefined)).toBe('zoom');
    expect(radialBlurMode('anything')).toBe('zoom');
    expect(radialBlurMode('spin')).toBe('spin');
    expect(getDefaultParams('radial-blur').mode).toBe('zoom');
    const spin = directionalBlurPlan('radial-blur', { mode: 'spin', amount: 1 }, 1920, 1080);
    expect(spin.group).toBe('rotate');
    expect(spin.range([0, 0]).length).toBeCloseTo(Math.PI / 9, 9);
  });

  it('weights a partial last coarse box by its covered share (Radial zoom ranges vary per pixel)', () => {
    const plan = directionalBlurPlan('radial-blur', { amount: 1.3, centerX: 0.4, centerY: 0.45 }, 640, 360);
    for (const pixel of [[10, 10], [320, 170], [600, 300]] as [number, number][]) {
      const covered = directionalCoarseTaps(plan, pixel).map(tap => tap.weight / (1 - 0.5 * Math.min(1, Math.abs(tap.u) / Math.abs(plan.range(pixel).length))));
      expect(covered.reduce((total, share) => total + share, 0) * plan.step).toBeCloseTo(Math.abs(plan.range(pixel).length), 3);
    }
  });
});

describe('legacy blur graph upgrade', () => {
  const cases: [string, () => EffectOperatorGraph, () => EffectOperatorGraph][] = [
    ['box-blur', createLegacyBoxBlurGraph, createDefaultBoxBlurGraph],
    ['gaussian-blur', createLegacyGaussianBlurGraph, createDefaultGaussianBlurGraph],
    ['motion-blur', createLegacyMotionBlurGraph, createDefaultMotionBlurGraph],
    ['radial-blur', createLegacyRadialBlurGraph, createDefaultRadialBlurGraph],
    ['zoom-blur', createLegacyZoomBlurGraph, createDefaultZoomBlurGraph],
    // The 3.2.7 two-stage recipes: their stage A jumped when an animated amount changed its tap count.
    ['motion-blur', () => createEvenTapDirectionalBlurGraph('motion-blur'), createDefaultMotionBlurGraph],
    ['radial-blur', () => createEvenTapDirectionalBlurGraph('radial-blur'), createDefaultRadialBlurGraph],
    ['zoom-blur', () => createEvenTapDirectionalBlurGraph('zoom-blur'), createDefaultZoomBlurGraph],
  ];

  it.each(cases)('replaces an untouched saved %s graph, including packed compositions and layout', (type, legacy, current) => {
    const saved = recognizeOperatorCompositions(legacy());
    saved.layout = Object.fromEntries(Object.keys(saved.layout).map(id => [id, { x: 7, y: 9 }]));
    expect(matchesEffectRecipe(upgradeBlurGraph(type as never, saved), current())).toBe(true);
    expect(matchesEffectRecipe(effectOperatorGraph({ type, params: {}, operatorGraph: saved }), current())).toBe(true);
  });

  it.each(cases)('keeps an edited saved %s graph as the user left it', (type, legacy) => {
    const edited = legacy();
    const literal = edited.nodes.find(node => node.operator === 'values.number' && node.constants && !Object.keys(node.bindings).length)!;
    literal.constants = { value: Number(literal.constants!.value) + 0.5 };
    expect(upgradeBlurGraph(type as never, edited)).toBe(edited);
  });

  it('compiles the new math nodes: natural logarithm and ceiling', () => {
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, edges: [
      { id: 'a', from: 'value', output: 'value', to: 'log', input: 'value' }, { id: 'b', from: 'log', output: 'value', to: 'ceil', input: 'value' },
      { id: 'c', from: 'ceil', output: 'value', to: 'rgb', input: 'value' }, { id: 'd', from: 'rgb', output: 'rgb', to: 'combine', input: 'rgb' },
      { id: 'e', from: 'frame', output: 'image', to: 'split', input: 'image' }, { id: 'f', from: 'split', output: 'alpha', to: 'combine', input: 'alpha' },
      { id: 'g', from: 'combine', output: 'image', to: 'output', input: 'image' }],
    nodes: ([['frame', 'image.frame'], ['split', 'vector.split.rgba'], ['value', 'values.number'], ['log', 'math.log.scalar'], ['ceil', 'math.ceil.scalar'],
      ['rgb', 'convert.scalar-to-rgb'], ['combine', 'vector.combine.rgba'], ['output', 'image.output']] as const).map(([id, operator]) =>
      ({ id, operator, operatorVersion: 1, bindings: {}, ...(id === 'value' ? { constants: { value: 20 } } : {}) })) };
    const plan = compileImageOperatorGraph(graph, {});
    expect(plan.wgsl).toContain('log(');
    expect(plan.wgsl).toContain('ceil(');
    expect(evaluateImageOperatorPlan(plan, [0, 0, 0, 0.5])).toEqual([Math.ceil(Math.log(20)), Math.ceil(Math.log(20)), Math.ceil(Math.log(20)), 0.5]);
  });

  it('retires the old quality samples as hidden, documented no-ops', () => {
    for (const type of ['gaussian-blur', 'motion-blur', 'radial-blur', 'zoom-blur']) {
      expect(getEffect(type)!.params.samples).toMatchObject({ hidden: true, deprecated: expect.stringContaining('no effect') });
      expect(Object.values(getEffect(type)!.params).some(param => param.quality)).toBe(false);
    }
  });
  it('tells the agent catalog the same sign rule the renderer applies below 0', () => {
    for (const type of ['motion-blur', 'radial-blur', 'zoom-blur'] as const) {
      const text = catalogText(`effect:${type}`).description ?? '';
      const passesThrough = directionalBlurAmount(type, -0.2) === 0;
      const notes = blurBudgetNotes(type, { ...getDefaultParams(type), amount: -0.2 }, 1920, 1080);
      expect(notes.some(note => note.includes('leaves the picture unchanged'))).toBe(passesThrough);
      if (passesThrough) expect(text).toMatch(/below 0[^.;]*(leaves the picture unchanged|the picture stays unchanged)/);
      else expect(text).toMatch(/negative Amount streaks inward/);
      expect(text).not.toMatch(/negative \w+ draws the same streak/);
    }
  });

  it('names a negative Motion Blur Length in the percent its card shows', () => {
    expect(blurBudgetNotes('motion-blur', { ...getDefaultParams('motion-blur'), amount: -0.05 }, 1920, 1080)[0]).toMatch(/^Length -5% is below 0/);
    expect(blurBudgetNotes('radial-blur', { ...getDefaultParams('radial-blur'), amount: -0.5 }, 1920, 1080)[0]).toMatch(/^Amount -0.5 is below 0/);
  });
});
