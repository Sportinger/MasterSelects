// Ground truth for the blur graphs, independent of their own sampling shortcuts: discrete source
// textures read like the GPU reads them (bilinear, clamp-to-edge, rgba16float caches), compared
// with dense premultiplied kernels and with the legacy lengths saved projects rely on.
import { describe, expect, it } from 'vitest';
import { blurBudgetNotes, motionBlurHalfLengthPx, separableBlurTaps, type DirectionalBlurType } from '../../src/effects/blur/blurSampling';
import { isNeutralBlurEffect } from '../../src/services/operators/blurIdentity';
import { filmRoll } from '../../src/transitions/filmRoll';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

function evaluator(type: string, params: Record<string, unknown>, resolution: [number, number], source: (x: number, y: number) => Pixel) {
  const effect = { type, params };
  const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
  const run = createImagePassEvaluator(plan, resolution, discreteImage(resolution[0], resolution[1], source), { filterResources: true, float16: true });
  return (x: number, y: number) => run([(x + 0.5) / resolution[0], (y + 0.5) / resolution[1]]);
}

/** Opaque red left of `edge`, fully transparent black from it on. */
const hardEdge = (edge: number) => (x: number): Pixel => x < edge ? [1, 0, 0, 1] : [0, 0, 0, 0];

describe('blur ground truth on discrete textures', () => {
  it.each([['gaussian', 'gaussian-blur', 4], ['gaussian', 'gaussian-blur', 10], ['box', 'box-blur', 5]] as const)(
    '%s radius %s keeps a hard alpha edge clean and matches the dense premultiplied kernel', (kind, type, radius) => {
      // 1080 rows: the radius is in pixels; the edge is vertical, so only the horizontal kernel acts.
      const resolution: [number, number] = [240, 1080], edge = 100;
      const pixel = evaluator(type, { radius }, resolution, hardEdge(edge));
      const { sigma, radiusPx, pairs } = separableBlurTaps(kind, radius, ...resolution);
      const weight = (d: number) => kind === 'gaussian' ? Math.exp(-(d * d) / (2 * sigma * sigma)) : Math.min(1, Math.max(0, radiusPx + 1 - Math.abs(d)));
      for (let x = edge - 2 * pairs - 1; x <= edge + 2 * pairs + 1; x++) {
        let covered = 0, total = 0;
        for (let d = -2 * pairs; d <= 2 * pairs; d++) {
          const sampleX = Math.min(resolution[0] - 1, Math.max(0, x + d));
          covered += weight(d) * (sampleX < edge ? 1 : 0); total += weight(d);
        }
        const [red, green, blue, alpha] = pixel(x, 540);
        expect(alpha, `alpha at x=${x}`).toBeCloseTo(covered / total, 3);
        // Straight colour stays the edge colour wherever any coverage is left: no dark fringe.
        if (alpha > 1e-3) expect(red, `red at x=${x}, alpha ${alpha}`).toBeCloseTo(1, 2);
        expect(green).toBeCloseTo(0, 6); expect(blue).toBeCloseTo(0, 6);
      }
    });

  it.each([
    ['motion-blur', { amount: 12 / 240 }], ['zoom-blur', { amount: 0.4, centerX: 0.9, centerY: 0.5 }],
    ['radial-blur', { amount: 1.5, centerX: 0.95, centerY: 0.5 }], ['radial-blur', { mode: 'spin', amount: 1, centerX: 0.4, centerY: 0.1 }],
  ] as const)('%s %j keeps a hard alpha edge clean', (type, params) => {
    const resolution: [number, number] = [240, 135], edge = 120;
    const pixel = evaluator(type, params, resolution, hardEdge(edge));
    let blended = 0;
    for (let x = edge - 16; x <= edge + 16; x += 2) {
      const [red, , , alpha] = pixel(x, 67);
      if (alpha > 1e-3 && alpha < 0.999) blended++;
      if (alpha > 1e-3) expect(red, `red at x=${x}, alpha ${alpha}`).toBeCloseTo(1, 2);
    }
    expect(blended).toBeGreaterThan(2);
  });
});

describe('directional blur signs and limits', () => {
  const texture = (x: number, y: number): Pixel => [((x * 7 + y * 3) % 17) / 16, ((x * 5 + y * 11) % 13) / 12, ((x + y) % 5) / 4, (x * 3 + y) % 4 ? 1 : 0.4];
  const resolution: [number, number] = [96, 54];
  const sampleAt = (type: DirectionalBlurType, params: Record<string, unknown>) => {
    const pixel = evaluator(type, params, resolution, texture);
    return [[10, 7], [48, 27], [90, 50]].map(([x, y]) => pixel(x, y));
  };
  const finite = (pixels: Pixel[]) => pixels.every(value => value.every(Number.isFinite));

  it('passes the picture through below 0 for Motion and Radial Blur like the legacy shaders; Zoom Blur streaks inward', () => {
    // The legacy Motion and Radial shaders returned their input below Length 0.001 / Amount 0.01.
    const source = [[10, 7], [48, 27], [90, 50]].map(([x, y]) => texture(x, y));
    const same = (a: Pixel[], b: Pixel[]) => a.forEach((value, index) => value.forEach((channel, c) => expect(channel).toBeCloseTo(b[index][c], 2)));
    for (const [type, params] of [['motion-blur', { amount: -0.05, angle: 0.4 }], ['radial-blur', { amount: -0.5 }],
      ['radial-blur', { mode: 'spin', amount: -0.5 }]] as const) {
      same(sampleAt(type, params), source);
      expect(isNeutralBlurEffect({ type, params }, ...resolution), `${type} ${JSON.stringify(params)} is skipped`).toBe(true);
      expect(blurBudgetNotes(type, params, ...resolution).join(' ')).toMatch(/below 0.*unchanged/);
    }
    for (const params of [{ amount: -0.3 }, { amount: -5 }]) {
      const inward = sampleAt('zoom-blur', params), identity = sampleAt('zoom-blur', { amount: 0 });
      expect(finite(inward), JSON.stringify(params)).toBe(true);
      expect(inward).not.toEqual(identity);
      expect(isNeutralBlurEffect({ type: 'zoom-blur', params }, ...resolution)).toBe(false);
    }
  });

  it('stays finite far above the slider ranges', () => {
    for (const [type, params] of [['motion-blur', { amount: 2, angle: 1 }], ['zoom-blur', { amount: 20 }], ['radial-blur', { amount: 40 }],
      ['radial-blur', { mode: 'spin', amount: 30 }]] as const) expect(finite(sampleAt(type, params)), `${type} ${JSON.stringify(params)}`).toBe(true);
  });
});

describe('Motion Blur length keeps the legacy pixel length', () => {
  // Legacy shaders offset UVs by Length * (cos, sin): Length * |(cos W, sin H)| pixels to each side.
  it.each([[1920, 1080], [1080, 1920], [1080, 1080]] as const)('a vertical streak on %sx%s reaches Length * height', (width, height) => {
    expect(motionBlurHalfLengthPx(0.1, Math.PI / 2, width, height)).toBeCloseTo(0.1 * height, 9);
    expect(motionBlurHalfLengthPx(0.1, 0, width, height)).toBeCloseTo(0.1 * width, 9);
    expect(motionBlurHalfLengthPx(-0.1, Math.PI / 2, width, height)).toBeCloseTo(-0.1 * height, 9);
  });

  it.each([[192, 108], [108, 192], [128, 128]] as const)('the graph streaks a line Length * height up and down on %sx%s', (width, height) => {
    // A white line on black, blurred vertically: rows within the reach pick it up, rows beyond it at
    // most a trace (the partial last coarse box keeps its full stage A box and spills its share × taper).
    const line = Math.round(height / 2), reach = 0.1 * height;
    const pixel = evaluator('motion-blur', { amount: 0.1, angle: Math.PI / 2 }, [width, height], (_x, y) => y === line ? [1, 1, 1, 1] : [0, 0, 0, 1]);
    for (const direction of [-1, 1]) {
      expect(pixel(width / 2, line + direction * Math.floor(reach - 1.5))[0], `inside, ${direction}`).toBeGreaterThan(1e-3);
      expect(pixel(width / 2, line + direction * Math.ceil(reach + 1.5))[0], `outside, ${direction}`).toBeLessThan(1 / 2048);
    }
  });

  it('keeps Film Roll at the legacy Length 0.1, so saved transition compositions render unchanged', () => {
    const blurs = filmRoll.recipe.filter(step => step.kind === 'effect' && step.effectType === 'motion-blur');
    expect(blurs).toHaveLength(2);
    for (const step of blurs) {
      const { amount, angle } = (step as { params: { amount: { from: number; to: number }; angle: number } }).params;
      expect(Math.max(amount.from, amount.to)).toBe(0.1);
      // A materialized composition stores these keyframes (0 → 0.1): the streak is 10 % of the height on every aspect ratio.
      for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
        expect(motionBlurHalfLengthPx(0.1, angle, width, height)).toBeCloseTo(0.1 * height, 3);
      }
    }
  });
});
