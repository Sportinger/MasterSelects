// Crosshatch Line Weight: 0 keeps the fixed thin lines of saved projects, 1 lets the shadows reach near-solid ink.
// The reference below mirrors the shader twin (crosshatchFragment / hatchLine in src/effects/geometry/shader.wgsl).
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { HATCH_HAIRLINE, HATCH_LAYERS, LINE_EDGE_PIXELS } from '../../src/services/operators/geometryFragmentEffectGraphs';

type Rgba = [number, number, number, number];
const RESOLUTION: [number, number] = [1920, 1080];
const POINTS: [number, number][] = Array.from({ length: 400 }, (_, index) => [((index * 37) % 400 + .5) / 400, ((index * 61) % 400 + .5) / 400]);
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const fract = (x: number) => x - Math.floor(x);
const hex = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);

/** The shader twin's hatch value at a pixel position, for a pixel of this tone. */
function referenceHatch(uv: [number, number], tone: number, scale: number, weight: number): number {
  const size = Math.max(Math.max(scale, 2) * Math.min(...RESOLUTION) / 1080, 1);
  const x = uv[0] * RESOLUTION[0] / size, y = uv[1] * RESOLUTION[1] / size, w = Math.min(Math.max(weight, 0), 1);
  const coordinates = [x + y, x - y, x * .5];
  return Math.max(...HATCH_LAYERS.map((layer, index) => {
    const soft = LINE_EDGE_PIXELS * layer.pitch / size;
    const heavy = Math.min(Math.max((layer.toneLimit - tone) * (layer.heavy / layer.toneLimit), HATCH_HAIRLINE), layer.heavy);
    const width = (layer.low + layer.high) / 2 * (1 - w) + heavy * w;
    const line = 1 - smoothstep(width - soft, width + soft, Math.abs(fract(coordinates[index]) - .5));
    return layer.toneLimit >= tone ? line : 0;
  }));
}

function renderFlat(color: Rgba, params: Record<string, number | string>, keepSaved = false) {
  const effect = { type: 'crosshatch', params: keepSaved ? params : { ...getDefaultParams('crosshatch'), ...params } };
  const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
  return POINTS.map(uv => evaluateImageOperatorPlan(plan, color, { uv, resolution: RESOLUTION, timelineTimeSeconds: 0, sampleImage: () => color,
    loadImage: () => color, pixelCoordinate: [Math.floor(uv[0] * RESOLUTION[0]), Math.floor(uv[1] * RESOLUTION[1])], derivativeAutoMode: 'coarse' }) as Rgba);
}
/** Share of ink in the rendered red channel between Paper (0) and Ink (1), at Amount 1. */
const inkShare = (pixels: Rgba[], ink = '#000000', paper = '#ffffff') => {
  const [inkRed] = hex(ink), [paperRed] = hex(paper);
  return pixels.reduce((sum, pixel) => sum + (paperRed - pixel[0]) / (paperRed - inkRed), 0) / pixels.length;
};
const BW = { amount: 1, colorA: '#000000', colorB: '#ffffff' };

describe('Crosshatch Line Weight', () => {
  it('is a 0–1 card control that saved projects without it read as 0, the fixed lines they were made with', () => {
    const weight = getEffect('crosshatch')!.params.weight;
    expect(weight).toMatchObject({ type: 'number', label: 'Line Weight', min: 0, max: 1, legacyDefault: 0, group: 'Pattern' });
    expect(effectOperatorParams({ type: 'crosshatch', params: { scale: 14, amount: .75 } }).weight).toBe(0);
    expect(getEffect('crosshatch')!.params.scale).toMatchObject({ label: 'Line Spacing', unit: ' px' });
  });

  it.each([0, .6, 1])('matches the shader twin at Line Weight %s', weight => {
    for (const tone of [.05, .25, .45, .7, .9]) {
      const color: Rgba = [tone, tone, tone, 1];
      const pixels = renderFlat(color, { ...BW, weight, scale: 14 });
      pixels.forEach((pixel, index) => expect(pixel[0], `tone ${tone} at ${POINTS[index]}`).toBeCloseTo(1 - referenceHatch(POINTS[index], tone, 14, weight), 4));
    }
  });

  it('lets black reach dense ink (over 85 %, thin paper gaps between the strokes) at Line Weight 1, where the fixed lines stopped at about half', () => {
    const black: Rgba = [0, 0, 0, 1];
    expect(inkShare(renderFlat(black, { ...BW, weight: 0 }))).toBeLessThan(.6);
    expect(inkShare(renderFlat(black, { ...BW, weight: 1 }))).toBeGreaterThan(.85);
    // Ink grows with darkness at every weight, and a light tone stays paper.
    for (const weight of [0, .6, 1]) {
      const shares = [.95, .7, .45, .2, 0].map(tone => inkShare(renderFlat([tone, tone, tone, 1], { ...BW, weight })));
      expect(shares[0], `weight ${weight}`).toBe(0);
      for (let i = 1; i < shares.length; i++) expect(shares[i], `weight ${weight}`).toBeGreaterThanOrEqual(shares[i - 1] - 1e-6);
    }
  });

  it.each([12, 60])('softens every line edge over about one output pixel at %s px spacing', scale => {
    // Walk along a row through the first diagonal set alone (tone .7): its ramp from 10 % to 90 % ink, measured across
    // the line (the row crosses it at 45°, so divide by √2), spans about a pixel.
    const tone = .7, row = Array.from({ length: 4 * scale * 20 }, (_, index) => [(index / 20 + .5) / RESOLUTION[0], .5] as [number, number]);
    const values = row.map(uv => referenceHatch(uv, tone, scale, 0));
    let widest = 0, start = -1;
    values.forEach((value, index) => {
      const ramping = value > .1 && value < .9;
      if (ramping && start < 0) start = index;
      if (!ramping && start >= 0) { widest = Math.max(widest, (index - start) / 20); start = -1; }
    });
    expect(widest / Math.SQRT2).toBeGreaterThan(.5);
    expect(widest / Math.SQRT2).toBeLessThan(1.6);
  });

  it('keeps a paper gap of at least 1.5 px (at half ink) between the diagonal lines at 6 px spacing, even in black', () => {
    for (const layer of HATCH_LAYERS.slice(0, 2)) expect((1 - 2 * layer.heavy) * 6 / Math.SQRT2).toBeGreaterThan(1.5);
  });

  it('clamps Line Weight outside 0–1 and says so', () => {
    const over = renderFlat([.3, .3, .3, 1], { ...BW, weight: 4 }), one = renderFlat([.3, .3, .3, 1], { ...BW, weight: 1 });
    over.forEach((pixel, index) => expect(pixel[0]).toBeCloseTo(one[index][0], 5));
    const effect = { type: 'crosshatch', params: { ...getDefaultParams('crosshatch'), weight: 4 } };
    const notes = paramRangeNotes(getEffect('crosshatch')!.params, effect.params, effectOperatorGraph(effect));
    expect(notes.map(note => note.param)).toContain('weight');
  });

  it('declares named presets that keep their colours and stay in range', () => {
    const presets = getEffect('crosshatch')!.presets ?? [];
    expect(presets.map(preset => preset.name)).toEqual(['Pen Sketch', 'Etching', 'Ballpoint', 'Woodcut', 'Coloured Sketch']);
    for (const preset of presets) {
      expect(preset.params.weight as number).toBeGreaterThanOrEqual(0);
      expect(preset.params.weight as number).toBeLessThanOrEqual(1);
      expect(preset.params.scale as number).toBeGreaterThanOrEqual(2);
    }
  });
});
