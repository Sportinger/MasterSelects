import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultCrtScreenGraph } from '../../src/services/operators/crtScreenRecipe';
import { createDefaultGlitchGraph } from '../../src/services/operators/glitchRecipe';
import { createDefaultFilmPrismGraph } from '../../src/services/operators/filmPrismRecipe';
import { createDefaultHoloGraph } from '../../src/services/operators/holoRecipe';
import { createDefaultRibbonScanGraph } from '../../src/services/operators/ribbonScanRecipe';
import { getDefaultParams, getEffect } from '../../src/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { organizeEffectFamilyGraph } from '../../src/services/operators/effectFamilyPresentation';

type Params = Record<string, number | string | boolean>;
const recipes: Record<string, () => EffectOperatorGraph> = {
  'crt-screen': createDefaultCrtScreenGraph, glitch: createDefaultGlitchGraph, 'film-prism': createDefaultFilmPrismGraph,
  holo: createDefaultHoloGraph, 'ribbon-scan': createDefaultRibbonScanGraph,
};

/** The recipe of `type` with its defaults plus `overrides`, evaluated like the GPU (bilinear rgba16float caches). */
function render(type: string, overrides: Params, image: (x: number, y: number) => Pixel, [width, height]: [number, number], time = 0) {
  const params = { ...getDefaultParams(type), ...overrides };
  const plan = compileImageOperatorGraph(recipes[type](), params, { parameterSchema: getEffect(type)!.params });
  const evaluate = createImagePassEvaluator(plan, [width, height], discreteImage(width, height, image), { filterResources: true, float16: true, timelineTimeSeconds: time });
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
  for (const [type, off] of [['crt-screen', { amount: 0 }], ['glitch', { amount: 0 }], ['film-prism', { amount: 0, grain: 0 }],
    ['holo', { amount: 0 }], ['ribbon-scan', { amount: 0 }]] as const) {
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

  it('keeps the exposure of dark, mid and bright tones (each beam carries its line\'s light)', () => {
    for (const level of [.1, .25, .5, .75]) {
      const output = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: 240 }, grey(level), [4, 1080]);
      const mean = Array.from({ length: 900 }, (_, i) => toLinear(output(2, i + 90)[1])).reduce((a, b) => a + b) / 900;
      expect(mean / toLinear(level), `grey ${level}`).toBeGreaterThan(.95);
      expect(mean / toLinear(level), `grey ${level}`).toBeLessThan(1.05);
    }
  });

  it('keeps the average light of the Slot Mask', () => {
    // Mask Size 4: 12 px triads, slots every 24 rows; average a whole number of both.
    const output = render('crt-screen', { curvature: 0, scanlines: 0, flicker: 0, maskStrength: 1, maskSize: 4, maskType: 'slot' }, grey(.4), [96, 1080]);
    for (const channel of [0, 1, 2]) {
      let sum = 0, count = 0;
      for (let y = 480; y < 528; y++) for (let x = 0; x < 96; x++, count++) sum += toLinear(output(x, y)[channel]);
      expect(sum / count / toLinear(.4), `channel ${channel}`).toBeGreaterThan(.95);
      expect(sum / count / toLinear(.4), `channel ${channel}`).toBeLessThan(1.05);
    }
  });

  it('keeps every row of a line at any line height (thin detail is never skipped)', () => {
    // One bright row at each row offset inside a line: the light shown around it stays that of the row.
    // 4.5 px lines (240 at 1080), 9 px (240 at 2160 and 120 at 1080) and 18 px (60 at 1080).
    for (const [height, lines] of [[1080, 240], [2160, 240], [1080, 120], [1080, 60]] as const) {
      const period = height / lines, start = Math.round(period * 2);
      for (let offset = 0; offset < Math.ceil(period); offset++) {
        const bright = start + offset;
        const output = render('crt-screen', { curvature: 0, maskStrength: 0, flicker: 0, scanlines: 1, lineCount: lines },
          (_x, y) => y === bright ? [1, 1, 1, 1] : [0, 0, 0, 1], [4, height]);
        let shown = 0;
        for (let y = start - Math.ceil(period * 2); y < start + Math.ceil(period * 3); y++) shown += toLinear(output(2, y)[1]);
        expect(shown, `${lines} lines at ${height} rows, row ${offset} of the line`).toBeGreaterThan(.8);
        expect(shown, `${lines} lines at ${height} rows, row ${offset} of the line`).toBeLessThan(1.25);
      }
    }
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

  it('only moves whole texels: every output channel is a source texel value or, in a channel-swapped block, the even mix of two (no blur)', () => {
    // At Intensity 1 every burst level is at least 0.35, where swapped blocks blend their rotated channels exactly half.
    const values = [...new Set(Array.from({ length: size[0] * size[1] }, (_, i) => opaque(i % size[0], Math.floor(i / size[0]))).flatMap(pixel => pixel.slice(0, 3)))];
    const halves = new Set(values.flatMap(a => values.map(b => ((a + b) / 2).toFixed(3))));
    for (const time of [0, .33, .5, 1.25]) {
      const output = render('glitch', { amount: 1, density: .8 }, opaque, size, time);
      for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) for (const value of output(x, y).slice(0, 3)) {
        expect(texels.has(value.toFixed(3)) || halves.has(value.toFixed(3))).toBe(true);
      }
    }
  });

  it('only tints flat areas slightly where blocks swap channels (no solid placeholder tiles)', () => {
    // Flat sky: a full channel rotation would turn it mint; flat blocks rotate at most 0.15 of the way.
    const sky = (): Pixel => [.36, .55, .8, 1];
    let largest = 0, swappedFrames = 0;
    for (const time of [.1, .35, .59, .85, 1.1, 1.35, 1.6, 1.85, 2.1, 2.35]) {
      const output = render('glitch', { amount: 1, density: 1, split: 0 }, sky, [96, 54], time);
      let frameLargest = 0;
      for (let y = 0; y < 54; y++) for (let x = 0; x < 96; x++) output(x, y).slice(0, 3).forEach((value, channel) => {
        frameLargest = Math.max(frameLargest, Math.abs(value - sky()[channel]));
      });
      if (frameLargest > 1e-3) swappedFrames++;
      largest = Math.max(largest, frameLargest);
    }
    expect(swappedFrames).toBeGreaterThan(0);
    expect(largest).toBeLessThan(.07);
  });

  it('moves almost nothing at a faint Intensity (block offsets round to the nearest block)', () => {
    const changedShare = (amount: number) => {
      let changed = 0, total = 0;
      for (const time of [.1, .35, .6, .85, 1.1, 1.35, 1.6, 1.85]) {
        const output = render('glitch', { amount, density: 1, split: 0 }, opaque, [96, 54], time);
        for (let y = 0; y < 54; y++) for (let x = 0; x < 96; x++, total++) {
          if (output(x, y).some((value, channel) => Math.abs(value - opaque(x, y)[channel]) > 2 / 255)) changed++;
        }
      }
      return changed / total;
    };
    expect(changedShare(0)).toBe(0);
    expect(changedShare(.002)).toBeLessThan(.005);
    expect(changedShare(.01)).toBeLessThan(.005);
    expect(changedShare(1)).toBeGreaterThan(.1);
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

  it('keeps a hard edge sharp in brightness at the default Fringe: only colour spreads', () => {
    // Default Fringe 0.5 on 540 rows: reads spread ±4 px along Angle 0. The luma step stays within 2 px.
    const edge = (x: number): Pixel => x < 32 ? [0, 0, 0, 1] : [1, 1, 1, 1];
    const output = render('film-prism', { mode: 'prism', angle: 0, grain: 0 }, edge, [64, 540]);
    const row = Array.from({ length: 64 }, (_, x) => output(x, 270));
    const luma = row.map(([r, g, b]) => .2126 * r + .7152 * g + .0722 * b);
    expect(luma.filter(value => value > .1 && value < .9).length).toBeLessThanOrEqual(2);
    for (let x = 0; x < 30; x++) expect(luma[x], `x ${x}`).toBeLessThan(.1);
    for (let x = 34; x < 64; x++) expect(luma[x], `x ${x}`).toBeGreaterThan(.9);
    // The edge still gains a coloured fringe on both sides.
    expect(Math.max(...row.slice(26, 32).map(([r, , b]) => Math.abs(r - b)))).toBeGreaterThan(.05);
    expect(Math.max(...row.slice(32, 38).map(([r, , b]) => Math.abs(r - b)))).toBeGreaterThan(.05);
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

describe('analog recipes open as readable stage folders', () => {
  const stages: Record<string, string[]> = {
    'crt-screen': ['Tube Shape & Rim', 'Scanline Beams', 'Phosphor Mask', 'Hum Bar & Flutter', 'Light Out & Alpha'],
    glitch: ['Burst Clock', 'Torn Rows', 'Block Copies', 'Read Position & RGB Split', 'Channel Reads & Swap', 'Colour & Alpha'],
    'film-prism': ['Fringe Spread & Direction', 'Tap Positions', 'Spectrum Reads & Sum', 'Sharp Brightness', 'Grain Noise', 'Grain Strength', 'Add Grain & Alpha'],
  };
  for (const [type, labels] of Object.entries(stages)) {
    it(`${type} puts every computation in a stage folder (no folder dropped for a cycle)`, () => {
      const graph = recipes[type]();
      const organized = organizeEffectFamilyGraph(graph, recognizeOperatorCompositions(graph), type, recipes[type]);
      expect(organized.groups!.map(group => group.label)).toEqual(expect.arrayContaining(['Parameters', 'Constants', ...labels]));
      const grouped = new Set(organized.groups!.flatMap(group => group.nodeIds));
      expect(organized.nodes.filter(node => !grouped.has(node.id)).map(node => node.id).toSorted()).toEqual(['frame', 'output']);
    });
  }
});

describe('Holo recipe', () => {
  const size: [number, number] = [48, 27];
  const scene = (x: number, y: number): Pixel => [x < size[0] / 2 ? .15 : .8, .3 + .3 * (y / size[1]), .5, 1];
  const difference = (amount: number) => {
    const output = render('holo', { amount }, scene, size, .5);
    let sum = 0;
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) sum += [0, 1, 2].reduce((total, c) => total + Math.abs(output(x, y)[c] - scene(x, y)[c]), 0);
    return sum;
  };

  it('Amount acts as strength: the change from the source grows in proportion to it', () => {
    const full = difference(1);
    expect(full).toBeGreaterThan(size[0] * size[1] * .05);
    for (const amount of [.35, .7]) expect(difference(amount) / full).toBeCloseTo(amount, 2);
  });

  it('keeps true black black away from outlines and lights the outline of a bright shape', () => {
    // A bright square on black at full Amount and Stripes: the floor stays black, the square's outline gains foil.
    const square = (x: number, y: number): Pixel => x >= 24 && x < 40 && y >= 12 && y < 24 ? [.8, .8, .8, 1] : [0, 0, 0, 1];
    const output = render('holo', { amount: 1, stripes: 1 }, square, [64, 36]);
    for (const [x, y] of [[4, 4], [60, 4], [4, 32], [60, 32], [10, 18]]) expect(Math.max(...output(x, y).slice(0, 3)), `${x},${y}`).toBeLessThan(.01);
    expect(Math.max(...output(23, 18).slice(0, 3))).toBeGreaterThan(.1);
  });

  it('stays inside [0, 1] and lights outlines the same at any resolution (edge reach in frame heights)', () => {
    const mean = ([width, height]: [number, number]) => {
      const step = (x: number): Pixel => x < width / 2 ? [.1, .1, .1, 1] : [.9, .9, .9, 1];
      const output = render('holo', { amount: 1, stripes: 0 }, x => step(x), [width, height], .5);
      // A vertical step: every row alike, so a few rows across the middle stand for the frame.
      let sum = 0, count = 0;
      for (const y of [height / 2 - 2, height / 2, height / 2 + 1]) for (let x = 0; x < width; x++, count++) {
        for (const value of output(x, y)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
        sum += output(x, y)[1];
      }
      return sum / count;
    };
    // The outline is ±0.2 % of the frame height wide: 2 px at 1080 lines, 4 px at 2160.
    const edgeLight = (size: [number, number]) => mean(size) - (.1 + .9) / 2;
    expect(Math.abs(edgeLight([1920, 1080]) - edgeLight([3840, 2160]))).toBeLessThan(.002);
  });
});

describe('Ribbon Scan recipe', () => {
  /** A one-pixel white column at x = 200 on black. */
  const column = (x: number): Pixel => x === 200 ? [1, 1, 1, 1] : [0, 0, 0, 1];
  const reach = (amount: number) => {
    const output = render('ribbon-scan', { amount, scale: 4, speed: 0 }, x => column(x), [400, 120], 0);
    let farthest = 0;
    for (let y = 0; y < 120; y++) {
      const row = Array.from({ length: 400 }, (_, x) => output(x, y)[0]);
      farthest = Math.max(farthest, Math.abs(row.indexOf(Math.max(...row)) - 200));
    }
    return farthest;
  };

  it('shifts by up to Displacement squared x 6 % of the width', () => {
    expect(reach(1)).toBeGreaterThan(.06 * 400 * .85); expect(reach(1)).toBeLessThanOrEqual(.06 * 400 + 1);
    expect(reach(.3)).toBeLessThanOrEqual(Math.ceil(.09 * .06 * 400) + 1);
    expect(reach(.5)).toBeGreaterThan(reach(.3));
  });

  it('mirrors or wraps reads past the frame edge instead of smearing the edge column', () => {
    // A gradient: a clamped read would repeat the edge value; mirrored and wrapped reads bring other columns.
    const gradient = (x: number): Pixel => [x / 63, 0, 0, 1];
    for (const edges of ['mirror', 'wrap']) {
      const output = render('ribbon-scan', { amount: 1, scale: 3, speed: 0, edges }, x => gradient(x), [64, 90], 0);
      const edgeValues = Array.from({ length: 90 }, (_, y) => output(0, y)[0]);
      const expected = edges === 'mirror' ? (value: number) => value >= 0 : (value: number) => value > .5;
      expect(edgeValues.some(value => value > 1.5 / 63 && expected(value)), edges).toBe(true);
    }
  });
});

