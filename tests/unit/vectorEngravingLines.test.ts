// Vector Engraving: Line Weight lets the lines swell to near-solid ink in the shadows (0 keeps saved projects' fixed lines),
// the wave runs along the whole line instead of breaking at each cell edge, and Angle turns the lines in pixels, so the
// spacing is the same at every angle on a 16:9 frame. The reference mirrors the shader twin (vectorTilingFragment).
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { ENGRAVING_LINE, LINE_EDGE_PIXELS } from '../../src/services/operators/geometryFragmentEffectGraphs';

type Rgba = [number, number, number, number];
const RESOLUTION: [number, number] = [1920, 1080];
const POINTS: [number, number][] = Array.from({ length: 300 }, (_, index) => [((index * 37) % 300 + .5) / 300, ((index * 61) % 300 + .5) / 300]);
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const fract = (x: number) => x - Math.floor(x);
const BW = { amount: 1, colorA: '#000000', colorB: '#ffffff' };

/** The shader twin's engraving value at a pixel position, for a flat picture of this tone. */
function referenceEngraving(uv: [number, number], tone: number, scale: number, weight: number, angleDegrees = 0): number {
  const spacing = Math.max(Math.max(scale, 3) * Math.min(...RESOLUTION) / 1080, 1), angle = angleDegrees * Math.PI / 180;
  const px = uv[0] * RESOLUTION[0] - RESOLUTION[0] / 2, py = uv[1] * RESOLUTION[1] - RESOLUTION[1] / 2;
  const along = (px * Math.cos(angle) - py * Math.sin(angle)) / spacing, across = (px * Math.sin(angle) + py * Math.cos(angle)) / spacing;
  const darkness = 1 - tone, w = Math.min(Math.max(weight, 0), 1), line = ENGRAVING_LINE;
  const waved = across - Math.sin(along * line.waveFrequency) * darkness * line.waveDepth;
  const hairline = Math.max(line.hairline, line.hairlinePixels / spacing), soft = LINE_EDGE_PIXELS / spacing;
  const width = line.fixedWidth * (1 - w) + Math.min(Math.max(darkness * line.heavy, hairline), line.heavy) * w;
  return 1 - smoothstep(width - soft, width + soft, Math.abs(fract(waved) - .5));
}

function render(color: Rgba, params: Record<string, number | string>, points: [number, number][] = POINTS) {
  const effect = { type: 'vector-tiling', params: { ...getDefaultParams('vector-tiling'), ...params } };
  const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
  // The Cell Filter passes are cached; evaluate them where they are read (a flat picture averages to itself).
  const producers = new Map((plan.passes ?? []).filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const at = (program: ImageOperatorPlan, uv: [number, number]): Rgba => evaluateImageOperatorPlan(program, color, { uv, resolution: RESOLUTION,
    timelineTimeSeconds: 0, sampleImage: () => color, sampleResource: (id, point) => at(producers.get(id)!, point) }) as Rgba;
  const final = plan.passes?.length ? plan.passes.at(-1)!.program : plan;
  return points.map(uv => at(final, uv));
}
/** Share of ink (black on white, Amount 1) over the rendered points. */
const inkShare = (pixels: Rgba[]) => pixels.reduce((sum, pixel) => sum + 1 - pixel[0], 0) / pixels.length;
const grey = (tone: number): Rgba => [tone, tone, tone, 1];

describe('Vector Engraving lines', () => {
  it('has Line Spacing and a 0–1 Line Weight that saved projects without it read as 0', () => {
    const params = getEffect('vector-tiling')!.params;
    expect(params.weight).toMatchObject({ type: 'number', label: 'Line Weight', min: 0, max: 1, legacyDefault: 0, group: 'Pattern' });
    expect(params.scale).toMatchObject({ label: 'Line Spacing', unit: ' px' });
    expect(effectOperatorParams({ type: 'vector-tiling', params: { scale: 14, amount: .75, angle: 0 } }).weight).toBe(0);
  });

  it.each([[0, 0], [.7, 0], [1, 30], [.7, 90]])('matches the shader twin at Line Weight %s, Angle %s', (weight, angle) => {
    for (const tone of [.05, .35, .7, .95]) {
      const pixels = render(grey(tone), { ...BW, weight, angle, scale: 14 });
      pixels.forEach((pixel, index) => expect(pixel[0], `tone ${tone} at ${POINTS[index]}`).toBeCloseTo(1 - referenceEngraving(POINTS[index], tone, 14, weight, angle), 4));
    }
  });

  it('lets black reach near-solid ink at Line Weight 1 and keeps ink growing with darkness', () => {
    expect(inkShare(render(grey(0), { ...BW, weight: 0 }))).toBeLessThan(.25);
    expect(inkShare(render(grey(0), { ...BW, weight: 1 }))).toBeGreaterThan(.85);
    for (const weight of [.4, .7, 1]) {
      const shares = [1, .75, .5, .25, 0].map(tone => inkShare(render(grey(tone), { ...BW, weight })));
      for (let i = 1; i < shares.length; i++) expect(shares[i], `weight ${weight}`).toBeGreaterThan(shares[i - 1]);
    }
  });

  it('draws unbroken waves: no jump where the old per-cell wave restarted', () => {
    // Spacing 14 px at 1080p; a column of points just left and right of each whole line-spacing step along the line.
    const spacing = 14, x0 = RESOLUTION[0] / 2, column = Array.from({ length: 120 }, (_, i) => (i + .5) / 120 * RESOLUTION[1]);
    for (const step of [3, 7, 20]) {
      const left = render(grey(.1), { ...BW, weight: .7, scale: spacing }, column.map(y => [(x0 + step * spacing - .01) / RESOLUTION[0], y / RESOLUTION[1]]));
      const right = render(grey(.1), { ...BW, weight: .7, scale: spacing }, column.map(y => [(x0 + step * spacing + .01) / RESOLUTION[0], y / RESOLUTION[1]]));
      left.forEach((pixel, index) => expect(Math.abs(pixel[0] - right[index][0]), `step ${step}, y ${column[index]}`).toBeLessThan(.02));
    }
  });

  it.each([30, 45, 90])('keeps the line spacing in pixels at Angle %s on a 16:9 frame', angle => {
    // One spacing across the lines, along (sin, cos) of the angle, lands on the same place of the next line.
    const spacing = 14, radians = angle * Math.PI / 180;
    const start: [number, number][] = POINTS.slice(0, 80).map(([u, v]) => [.25 + u * .5, .25 + v * .5]);
    const moved = start.map(([u, v]) => [u + Math.sin(radians) * spacing / RESOLUTION[0], v + Math.cos(radians) * spacing / RESOLUTION[1]] as [number, number]);
    const a = render(grey(.4), { ...BW, weight: .7, scale: spacing, angle }, start), b = render(grey(.4), { ...BW, weight: .7, scale: spacing, angle }, moved);
    a.forEach((pixel, index) => expect(pixel[0], `${start[index]}`).toBeCloseTo(b[index][0], 3));
  });

  it.each([6, 60])('softens the line edge over about one output pixel at %s px spacing, and keeps a visible hairline on white', scale => {
    // Walk down a column through white (tone 1): the hairline keeps a peak near full ink, each edge ramps over about a pixel.
    const column = Array.from({ length: 2 * scale * 20 }, (_, index) => [.5, .5 + (index / 20) / RESOLUTION[1]] as [number, number]);
    const values = render(grey(1), { scale, weight: 1 }, column).map(pixel => 1 - pixel[0]);
    expect(Math.max(...values)).toBeGreaterThan(.6);
    let widest = 0, start = -1;
    values.forEach((value, index) => {
      const ramping = value > .1 && value < .9 * Math.max(...values);
      if (ramping && start < 0) start = index;
      if (!ramping && start >= 0) { widest = Math.max(widest, (index - start) / 20); start = -1; }
    });
    expect(widest).toBeLessThan(1.6);
  }, 60_000); // 2400 CPU samples at 60 px spacing: near the default 15 s on a slow CI runner

  it('clamps Line Weight outside 0–1 and says so', () => {
    const over = render(grey(.3), { ...BW, weight: 3 }), one = render(grey(.3), { ...BW, weight: 1 });
    over.forEach((pixel, index) => expect(pixel[0]).toBeCloseTo(one[index][0], 5));
    const effect = { type: 'vector-tiling', params: { ...getDefaultParams('vector-tiling'), weight: -2 } };
    expect(paramRangeNotes(getEffect('vector-tiling')!.params, effect.params, effectOperatorGraph(effect)).map(note => note.param)).toContain('weight');
  });

  it('declares five named presets in range', () => {
    const presets = getEffect('vector-tiling')!.presets ?? [];
    expect(presets.map(preset => preset.name)).toEqual(['Banknote', 'Copper Plate', 'Op Art', 'Cyanotype', 'Engraved Photo']);
    for (const preset of presets) {
      expect(preset.params.weight as number).toBeGreaterThanOrEqual(0);
      expect(preset.params.weight as number).toBeLessThanOrEqual(1);
      expect(preset.params.scale as number).toBeGreaterThanOrEqual(3);
    }
  });
});
