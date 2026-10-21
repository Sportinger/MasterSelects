import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultCrtScreenGraph } from '../../src/services/operators/crtScreenRecipe';
import { createDefaultGlitchGraph } from '../../src/services/operators/glitchRecipe';
import { createDefaultFilmPrismGraph } from '../../src/services/operators/filmPrismRecipe';
import { getDefaultParams, getEffect } from '../../src/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const recipes: Record<string, () => EffectOperatorGraph> = {
  'crt-screen': createDefaultCrtScreenGraph, glitch: createDefaultGlitchGraph, 'film-prism': createDefaultFilmPrismGraph,
};

/** The recipe of `type` with its defaults plus `overrides`, evaluated like the GPU (bilinear rgba16float caches). */
function render(type: string, overrides: Params, image: (x: number, y: number) => Pixel, [width, height]: [number, number], time = 0) {
  const params = { ...getDefaultParams(type), ...overrides };
  const plan = compileImageOperatorGraph(recipes[type](), params, { parameterSchema: getEffect(type)!.params });
  const evaluate = createImagePassEvaluator(plan, [width, height], discreteImage(width, height, image), { filterResources: true, float16: true, time });
  return (x: number, y: number) => evaluate([(x + .5) / width, (y + .5) / height]);
}

/** A test card with colour gradients, a hard edge and a transparent border (straight alpha). */
const card = (width: number, height: number) => (x: number, y: number): Pixel => {
  const inside = x >= 3 && y >= 2 && x < width - 3 && y < height - 2;
  return inside ? [x / width, y / height, (x + y) % 5 < 2 ? .9 : .15, 1] : [0, 0, 0, 0];
};
const grey = (value: number) => (): Pixel => [value, value, value, 1];
const toLinear = (value: number) => value ** 2.2;

function expectPixel(actual: Pixel, expected: Pixel, tolerance: number) {
  actual.forEach((value, channel) => expect(Math.abs(value - expected[channel]), `channel ${channel}: ${value} vs ${expected[channel]}`).toBeLessThan(tolerance));
}

describe('analog recipes are neutral at zero strength', () => {
  const size: [number, number] = [24, 14], source = card(...size);
  for (const [type, off] of [['crt-screen', { amount: 0 }], ['glitch', { amount: 0 }], ['film-prism', { amount: 0, grain: 0 }]] as const) {
    it(`${type} leaves every texel unchanged (colour and alpha, cut-out edges included)`, () => {
      const output = render(type, off, source, size, 1.37);
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        const expected = source(x, y);
        // Fully transparent texels may carry any colour; only coverage matters there.
        const actual = output(x, y);
        if (expected[3] === 0) expect(actual[3]).toBeLessThan(1e-3);
        else expectPixel(actual, expected, 2e-3);
      }
    });
  }
});

describe('CRT Screen recipe', () => {
  it('spaces scanlines Line Count to the frame height at any resolution', () => {
    for (const height of [96, 192]) {
      const output = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: 16 }, grey(.3), [8, height]);
      const column = Array.from({ length: height }, (_, y) => output(4, y)[1]);
      const peaks = column.flatMap((value, y) => y > 0 && y < height - 1 && value > column[y - 1] && value >= column[y + 1] ? [y] : []);
      const spacing = (peaks.at(-1)! - peaks[0]) / (peaks.length - 1);
      expect(spacing).toBeCloseTo(height / 16, 1);
      // Dark parts show the gaps between lines.
      expect(Math.min(...column) / Math.max(...column)).toBeLessThan(.65);
    }
  });

  it('lets bright lines fill the gaps and keeps the average exposure of the source', () => {
    const white = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: 24 }, grey(1), [8, 96]);
    for (let y = 8; y < 88; y++) expect(white(4, y)[0]).toBeGreaterThan(.9);
    const mid = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: 24 }, grey(.5), [8, 96]);
    const mean = Array.from({ length: 80 }, (_, i) => toLinear(mid(4, i + 8)[0])).reduce((a, b) => a + b) / 80;
    expect(mean / toLinear(.5)).toBeGreaterThan(.75);
    expect(mean / toLinear(.5)).toBeLessThan(1.1);
  });

  it('fades lines that would be closer than 2.25 px instead of aliasing', () => {
    const output = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: 80 }, grey(.3), [8, 96]);
    for (let y = 4; y < 92; y++) expect(output(4, y)[1]).toBeCloseTo(.3, 2);
  });

  it('keeps the average light of the phosphor mask', () => {
    // Mask Size is the stripe width at 1080 lines: 4 px stripes, 12 px triads, eight of them across.
    const output = render('crt-screen', { curvature: 0, scanlines: 0, flicker: 0, maskStrength: 1, maskSize: 4 }, grey(.4), [96, 1080]);
    const row = Array.from({ length: 96 }, (_, x) => output(x, 540).slice(0, 3).map(toLinear));
    for (const channel of [0, 1, 2]) {
      const mean = row.reduce((sum, pixel) => sum + pixel[channel], 0) / row.length;
      expect(mean / toLinear(.4)).toBeGreaterThan(.95);
      expect(mean / toLinear(.4)).toBeLessThan(1.05);
    }
    // Red, green and blue stripes peak at different columns.
    const peak = (channel: number) => row.findIndex(pixel => pixel[channel] === Math.max(...row.slice(0, 12).map(value => value[channel])));
    expect(new Set([peak(0), peak(1), peak(2)]).size).toBe(3);
  });

  it('cuts the tube corners to transparent only when curved', () => {
    const curved = render('crt-screen', { curvature: 1, flicker: 0 }, grey(.6), [64, 36]);
    expect(curved(0, 0)[3]).toBeLessThan(.01);
    expect(curved(32, 18)[3]).toBe(1);
    const flat = render('crt-screen', { curvature: 0, flicker: 0 }, grey(.6), [64, 36]);
    expect(flat(0, 0)[3]).toBeGreaterThan(.99);
  });

  it('renders finite colour for values outside the declared ranges and reports them', () => {
    const output = render('crt-screen', { lineCount: -5, curvature: 3, amount: 2, maskSize: -3, flicker: 9, scanlines: -1 }, card(24, 14), [24, 14], 7);
    for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) for (const value of output(x, y)) {
      expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1);
    }
    const definition = getEffect('crt-screen')!;
    const notes = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('crt-screen'), lineCount: -5, amount: 2 }, 1920, 1080) ?? [] : [];
    expect(notes.join(' ')).toMatch(/Line Count -5 .* renders as 16/);
    expect(notes.join(' ')).toMatch(/Mix 2 .* renders as 1/);
    const fine = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('crt-screen'), lineCount: 1000 }, 1920, 1080) ?? [] : [];
    expect(fine.join(' ')).toMatch(/fade out/);
  });
});

describe('Glitch recipe', () => {
  const size: [number, number] = [40, 24];
  const opaque = (x: number, y: number): Pixel => [((x * 7 + y * 3) % 11) / 10, ((x * 5 + y) % 7) / 6, ((x + y * 9) % 13) / 12, 1];
  const texels = new Set(Array.from({ length: size[0] * size[1] }, (_, i) => opaque(i % size[0], Math.floor(i / size[0]))).flatMap(pixel => pixel.slice(0, 3).map(value => value.toFixed(3))));

  it('only moves whole texels: every output channel is a source texel value (no blur, no new colours)', () => {
    for (const time of [0, .33, .5, 1.25]) {
      const output = render('glitch', { amount: 1, density: .8 }, opaque, size, time);
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) for (const value of output(x, y).slice(0, 3)) expect(texels.has(value.toFixed(3))).toBe(true);
    }
  });

  it('freezes at Speed 0 and changes over time otherwise', () => {
    const changed = (a: ReturnType<typeof render>, b: ReturnType<typeof render>) => {
      let count = 0;
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) if (a(x, y).some((value, channel) => value !== b(x, y)[channel])) count++;
      return count;
    };
    expect(changed(render('glitch', { speed: 0, density: .8 }, opaque, size, 0), render('glitch', { speed: 0, density: .8 }, opaque, size, 9.7))).toBe(0);
    let moving = 0;
    for (const time of [.1, .2, .3, .4]) moving += changed(render('glitch', { density: .8 }, opaque, size, time), render('glitch', { density: .8 }, opaque, size, time + .5));
    expect(moving).toBeGreaterThan(0);
  });

  it('still breaks up only part of the frame after ten hours of timeline', () => {
    for (const time of [.5, 36000.1, 36000.5]) {
      const output = render('glitch', { density: .35 }, opaque, size, time);
      let changed = 0;
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) if (output(x, y).some((value, channel) => Math.abs(value - opaque(x, y)[channel]) > 1e-3)) changed++;
      expect(changed / (size[0] * size[1])).toBeLessThan(.9);
    }
  });

  it('renders the original with Density 0 and RGB Split 0, and reports out-of-range values', () => {
    const output = render('glitch', { density: 0, split: 0 }, opaque, size, .5);
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) expectPixel(output(x, y), opaque(x, y), 1e-3);
    const definition = getEffect('glitch')!;
    const notes = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('glitch'), bands: 0, amount: 4 }) ?? [] : [];
    expect(notes).toHaveLength(2);
  });
});

describe('Film Prism recipe', () => {
  /** A white vertical line at x = 32 on black. */
  const line = (x: number): Pixel => x === 32 ? [1, 1, 1, 1] : [0, 0, 0, 1];

  it('spreads a Prism fringe of ±Fringe x 1.5 % of the frame height along Angle, red on one side and blue on the other', () => {
    const output = render('film-prism', { mode: 'prism', angle: 0, amount: 1, grain: 0 }, line, [64, 400]);
    const row = Array.from({ length: 64 }, (_, x) => output(x, 200));
    const reach = .015 * 400;
    const lit = (channel: number) => row.flatMap((pixel, x) => pixel[channel] > .01 ? [x] : []);
    // Red reads from the left of a pixel (t < 0 shifts the read along -Angle), so it appears to the right, blue to the left.
    expect(Math.max(...lit(0))).toBeGreaterThan(32 + reach * .6); expect(Math.min(...lit(0))).toBeGreaterThanOrEqual(32 - 2);
    expect(Math.min(...lit(2))).toBeLessThan(32 - reach * .6); expect(Math.max(...lit(2))).toBeLessThanOrEqual(32 + 2);
    expect(Math.max(...lit(0), ...lit(2)) - 32).toBeLessThanOrEqual(Math.ceil(reach) + 1);
    for (const pixel of row) expect(pixel[3]).toBeCloseTo(1, 3);
  });

  it('leaves the frame centre clean in the Lens shape', () => {
    const output = render('film-prism', { mode: 'lens', amount: 1, grain: 0 }, line, [64, 64]);
    expectPixel(output(32, 32), [1, 1, 1, 1], 2e-2);
    expectPixel(output(30, 32), [0, 0, 0, 1], 1e-3);
  });

  it('adds unbiased grain that changes every film frame and freezes at Grain Speed 0', () => {
    const size: [number, number] = [48, 48];
    const frame = (time: number, speed = 1) => { const output = render('film-prism', { amount: 0, grain: 1, speed }, grey(.5), size, time);
      return Array.from({ length: size[0] * size[1] }, (_, i) => output(i % size[0], Math.floor(i / size[0]))[0]); };
    const first = frame(0), next = frame(1 / 24 + 1e-4);
    const mean = first.reduce((a, b) => a + b) / first.length;
    const deviation = Math.sqrt(first.reduce((sum, value) => sum + (value - mean) ** 2, 0) / first.length);
    expect(Math.abs(mean - .5)).toBeLessThan(.02);
    expect(deviation).toBeGreaterThan(.02);
    expect(first.some((value, i) => Math.abs(value - next[i]) > .01)).toBe(true);
    expect(frame(0, 0)).toEqual(frame(5, 0));
  });
});
