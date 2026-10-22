// Contour Map: the lines sit on the band edges (not in the middle of each band) and keep their width in pixels on
// any slope, Fill tints the bands from Paper to the full Ink-to-Paper range, Smoothing reads the picture through a box
// average so noise does not draw stray rings, and Band Density under 60/7 (3 bands, as saved projects drew) is reported instead of silently clamped.
// The reference mirrors the shader twin (contourMapFragment) at Smoothing 0.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { CONTOUR_MAP } from '../../src/services/operators/geometryFragmentEffectGraphs';

type Rgba = [number, number, number, number];
type Picture = (uv: [number, number]) => number;
const RESOLUTION: [number, number] = [1920, 1080];
const BW = { amount: 1, colorA: '#000000', colorB: '#ffffff' };
const grey = (tone: number): Rgba => [tone, tone, tone, 1];

/** The shader twin's output (red channel, black ink on white paper) at a pixel of a grey picture. */
function reference(picture: Picture, uv: [number, number], scale: number, lineWidth: number, fill: number): number {
  const levels = Math.max(scale, CONTOUR_MAP.minimumDensity) * CONTOUR_MAP.levelsPerDensity, [dx, dy] = [1 / RESOLUTION[0], 1 / RESOLUTION[1]];
  const height = picture(uv) * levels;
  const slope = Math.max(Math.hypot(picture([uv[0] + dx, uv[1]]) - picture([uv[0] - dx, uv[1]]), picture([uv[0], uv[1] + dy]) - picture([uv[0], uv[1] - dy])) * levels * .5, CONTOUR_MAP.flatSlope);
  const nearest = Math.floor(height + .5), width = Math.max(lineWidth, 0);
  const line = Math.min(Math.max(width * .5 + .5 - Math.abs(height - nearest) / slope, 0), 1) * Math.min(width, 1)
    * (nearest >= .5 ? 1 : 0) * (levels - .5 >= nearest ? 1 : 0);
  const quantized = Math.min(1, Math.floor(height) / Math.max(1, Math.ceil(levels) - 1));
  const band = 1 + (quantized - 1) * Math.min(Math.max(fill, 0), 1);
  return band * (1 - line);
}

function render(picture: Picture, params: Record<string, number | string>, points: [number, number][], resolution = RESOLUTION) {
  const effect = { type: 'contour-map', params: { ...getDefaultParams('contour-map'), ...BW, ...params } };
  const plan = compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect), effectOperatorCompileContext(effect));
  // The Cell Filter passes are cached; evaluate them where they are read.
  const producers = new Map((plan.passes ?? []).filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const at = (program: ImageOperatorPlan, uv: [number, number]): Rgba => evaluateImageOperatorPlan(program, grey(picture(uv)), { uv, resolution,
    timelineTimeSeconds: 0, sampleImage: point => grey(picture(point)), sampleResource: (id, point) => at(producers.get(id)!, point) }) as Rgba;
  const final = plan.passes?.length ? plan.passes.at(-1)!.program : plan;
  return points.map(uv => at(final, uv)[0]);
}
/** Pixel centres of one row, from x0 to x1 (pixels), at height y (pixels). */
const row = (x0: number, x1: number, y = 540): [number, number][] =>
  Array.from({ length: x1 - x0 }, (_, i) => [(x0 + i + .5) / RESOLUTION[0], (y + .5) / RESOLUTION[1]]);
/** Ink across the row (paper 1 minus the pixel), in pixels. */
const inkPixels = (values: number[]) => values.reduce((sum, value) => sum + 1 - value, 0);
const ramp = (from: number, to: number): Picture => ([u]) => from + (to - from) * u;

describe('Contour Map lines', () => {
  it('has Band Density from 9 (3 bands), Line Width, Smoothing and Fill; saved projects read no smoothing and full bands', () => {
    const params = getEffect('contour-map')!.params;
    expect(params.scale).toMatchObject({ label: 'Band Density', min: 9, renderMin: 60 / 7 });
    expect(params.lineWidth).toMatchObject({ type: 'number', label: 'Line Width', min: 0, max: 6, unit: ' px' });
    expect(params.smoothing).toMatchObject({ type: 'number', label: 'Smoothing', min: 0, max: 32, legacyDefault: 0 });
    expect(params.fill).toMatchObject({ type: 'number', label: 'Fill', min: 0, max: 1, legacyDefault: 1 });
    expect(effectOperatorParams({ type: 'contour-map', params: { scale: 14, amount: .75, angle: 0 } })).toMatchObject({ smoothing: 0, fill: 1 });
  });

  it.each([[14, 1.8, .7], [30, 1, 0], [9, 3, 1], [50, .5, .4]])('matches the shader twin at Band Density %s, Line Width %s, Fill %s', (scale, lineWidth, fill) => {
    const picture: Picture = ([u, v]) => .5 + .45 * Math.sin(u * 5.1 + v * 2.3) * Math.cos(v * 3.7);
    const points = Array.from({ length: 240 }, (_, i): [number, number] => [((i * 37) % 240 + .5) / 240, ((i * 61) % 240 + .5) / 240]);
    const pixels = render(picture, { scale, lineWidth, fill, smoothing: 0 }, points);
    pixels.forEach((value, index) => expect(value, `${points[index]}`).toBeCloseTo(reference(picture, points[index], scale, lineWidth, fill), 3));
  });

  it('draws each line on a band edge at the same width in pixels on a steep and a shallow slope', () => {
    // Band Density 20 = 7 bands. Steep: the full range over the frame; shallow: a quarter of it.
    for (const [picture, from, to] of [[ramp(0, 1), 0, 1], [ramp(.25, .5), .25, .5]] as const) {
      const levels = 20 * CONTOUR_MAP.levelsPerDensity, edge = Math.ceil(from * levels + .01), x = (edge / levels - from) / (to - from) * RESOLUTION[0];
      for (const lineWidth of [1, 2, 4]) {
        const ink = inkPixels(render(picture, { scale: 20, lineWidth, fill: 0, smoothing: 0 }, row(Math.round(x) - 12, Math.round(x) + 12)));
        expect(ink, `ramp ${from}-${to}, width ${lineWidth}`).toBeCloseTo(lineWidth, 0);
      }
    }
  });

  it('draws no line on flat areas, on pure black or on pure white, and none at Line Width 0', () => {
    const points = row(900, 940);
    for (const tone of [0, .3, 1]) expect(inkPixels(render(() => tone, { scale: 20, fill: 0, smoothing: 0 }, points)), `tone ${tone}`).toBe(0);
    expect(inkPixels(render(ramp(0, 1), { scale: 40, lineWidth: 0, fill: 0, smoothing: 0 }, row(0, 400)))).toBe(0);
  });

  it('tints the bands with Fill: Paper at 0, Ink in the darkest band at 1', () => {
    const dark = row(100, 110);
    expect(render(() => .02, { fill: 0, smoothing: 0 }, dark).every(value => value === 1)).toBe(true);
    expect(render(() => .02, { fill: 1, smoothing: 0 }, dark).every(value => value === 0)).toBe(true);
    render(() => .02, { fill: .5, smoothing: 0 }, dark).forEach(value => expect(value).toBeCloseTo(.5, 5));
  });

  it('reads the picture through Smoothing, so noise draws fewer stray rings', () => {
    // A ramp with fine noise: unsmoothed, the noise crosses band edges again and again.
    const noisy: Picture = ([u, v]) => u * .5 + .25 + .03 * Math.sin(u * 1920 * 2.7 + v * 1080 * 1.3) * Math.sin(u * 1920 * .9 - v * 1080 * 2.1);
    const points = row(300, 700);
    const raw = inkPixels(render(noisy, { scale: 30, lineWidth: 1.5, fill: 0, smoothing: 0 }, points));
    const smooth = inkPixels(render(noisy, { scale: 30, lineWidth: 1.5, fill: 0, smoothing: 8 }, points));
    expect(smooth).toBeLessThan(raw * .5);
    expect(smooth).toBeGreaterThan(0);
  });

  it('reports values its graph clamps: Band Density under 60/7, Smoothing over 32, Fill and Line Width out of range', () => {
    const definitions = getEffect('contour-map')!.params;
    const values = { ...getDefaultParams('contour-map'), scale: 2, smoothing: 50, fill: 1.4, lineWidth: -1 };
    const graph = effectOperatorGraph({ type: 'contour-map', params: values });
    expect(paramRangeNotes(definitions, values, graph).map(note => note.param).toSorted()).toEqual(['fill', 'lineWidth', 'scale', 'smoothing']);
    const low = render(ramp(0, 1), { scale: 2, smoothing: 0 }, row(0, 200)), floor = render(ramp(0, 1), { scale: 60 / 7, smoothing: 0 }, row(0, 200));
    low.forEach((value, index) => expect(value).toBeCloseTo(floor[index], 6));
  });

  it('declares five named presets in range', () => {
    const effect = getEffect('contour-map')!, presets = effect.presets ?? [];
    expect(presets.map(preset => preset.name)).toEqual(['Hiking Map', 'Survey Lines', 'Sonar', 'Poster Bands', 'Topographic']);
    for (const preset of presets) for (const [key, value] of Object.entries(preset.params)) {
      const param = effect.params[key];
      if (param?.type !== 'number') continue;
      expect(value as number, `${preset.name} ${key}`).toBeGreaterThanOrEqual(param.min!);
      expect(value as number, `${preset.name} ${key}`).toBeLessThanOrEqual(param.max!);
    }
  });
});
