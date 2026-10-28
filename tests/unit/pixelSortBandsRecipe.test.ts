import { describe, expect, it } from 'vitest';
import { compileImageOperatorGraph, compileImageOperatorPreview } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultPixelSortBandsGraph } from '../../src/services/operators/pixelSortBandsRecipe';
import { effectOperatorGraph, isImageGraphEffectType } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams, getEffect } from '../../src/effects';
import { isMixedOut } from '../../src/engine/render/layerEffectStack';
import { createImagePassEvaluator, discreteImage, type Pixel } from '../helpers/imageGraphPasses';

type Params = Record<string, number | string | boolean>;
const size: [number, number] = [24, 16];
/** Every pixel sorts and no run breaks: whole lines are sorted. */
const everything: Params = { progress: 1, centre: 0.5, range: 1, variation: 0, maxLength: 4000 };

/** Seeded-looking but fixed colours, light enough to be inside any range. */
const noise = (x: number, y: number): Pixel => {
  const v = ((x * 7 + y * 13) % 17) / 17;
  return [v, (v * 3) % 1, 1 - v, 1];
};
const luma = ([r, g, b]: Pixel | number[]) => .2126 * r + .7152 * g + .0722 * b;

function render(overrides: Params, image: (x: number, y: number) => Pixel = noise) {
  const params = { ...getDefaultParams('pixel-sort-bands'), ...overrides };
  const plan = compileImageOperatorGraph(createDefaultPixelSortBandsGraph(), params, { parameterSchema: getEffect('pixel-sort-bands')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { filterResources: true, float16: true });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]]);
}
/** Run starts (seeded breaks) of the recipe's own `run-start` node, per pixel. */
function runStarts(overrides: Params, image: (x: number, y: number) => Pixel = noise) {
  const params = { ...getDefaultParams('pixel-sort-bands'), ...overrides };
  const plan = compileImageOperatorPreview(createDefaultPixelSortBandsGraph(), params, { nodeId: 'run-start', direction: 'output', portId: 'value' },
    { parameterSchema: getEffect('pixel-sort-bands')!.params });
  const evaluate = createImagePassEvaluator(plan, size, discreteImage(size[0], size[1], image), { filterResources: true, float16: true });
  return (x: number, y: number) => evaluate([(x + .5) / size[0], (y + .5) / size[1]])[0] >= .5;
}
/** Keys within each run (split where `starts` says so) never decrease (or increase for `descending`). */
function expectSortedRuns(keys: number[], starts: boolean[], descending = false) {
  keys.slice(1).forEach((key, index) => {
    if (starts[index + 1]) return;
    if (descending) expect(key).toBeLessThanOrEqual(keys[index] + 4e-3); else expect(key).toBeGreaterThanOrEqual(keys[index] - 4e-3);
  });
}
const close = (a: number[], b: number[], tolerance = 2e-3) => a.every((value, channel) => Math.abs(value - b[channel]) < tolerance);

describe('Pixel Sort Bands recipe', () => {
  it('is a graph-owned image effect whose default graph compiles to a Segment Sort pass', () => {
    expect(isImageGraphEffectType('pixel-sort-bands')).toBe(true);
    const graph = effectOperatorGraph({ id: 'fx', name: 'Pixel Sort Bands', type: 'pixel-sort-bands', enabled: true, params: getDefaultParams('pixel-sort-bands') });
    expect(graph.nodes.some(node => node.operator === 'image.segment-sort-axis')).toBe(true);
    const plan = compileImageOperatorGraph(graph, getDefaultParams('pixel-sort-bands'), { parameterSchema: getEffect('pixel-sort-bands')!.params });
    // The band cache is sorted directly: no extra colour copy pass.
    expect(plan.passes!.filter(pass => pass.segmentSort).map(pass => pass.segmentSort!.colorResource)).toEqual(['image-resource:band-cache:image']);
  });

  it('returns the input exactly at Progress 0, and the renderer skips it at Progress 0 or Amount 0', () => {
    const output = render({ ...everything, progress: 0 });
    for (let y = 0; y < size[1]; y += 2) for (let x = 0; x < size[0]; x += 3) expect(output(x, y)).toEqual(noise(x, y));
    expect(isMixedOut({ type: 'pixel-sort-bands', params: { progress: 0, amount: 1 } })).toBe(true);
    expect(isMixedOut({ type: 'pixel-sort-bands', params: { progress: 0.4, amount: 0 } })).toBe(true);
    expect(isMixedOut({ type: 'pixel-sort-bands', params: { progress: 0.4, amount: 1 } })).toBe(false);
  });

  it('sorts whole columns dark to light at Progress 1, keeping each column’s colours', () => {
    const output = render(everything), starts = runStarts(everything);
    let breaks = 0;
    for (const x of [0, 5, 11]) {
      const column = Array.from({ length: size[1] }, (_, y) => output(x, y));
      const flags = Array.from({ length: size[1] }, (_, y) => starts(x, y));
      breaks += flags.slice(1).filter(Boolean).length;
      expectSortedRuns(column.map(luma), flags);
      // The first run now starts with its darkest input pixel.
      const end = flags.indexOf(true, 1) === -1 ? size[1] : flags.indexOf(true, 1);
      const darkest = Array.from({ length: end }, (_, y) => noise(x, y)).sort((a, b) => luma(a) - luma(b))[0];
      expect(close(column[0], darkest)).toBe(true);
    }
    // Max Length 4000 at a 16-pixel-tall frame is about 59 pixels: seeded breaks are rare.
    expect(breaks).toBeLessThan(4);
  });

  it('sorts rows with Direction Horizontal and light to dark with Order High to Low', () => {
    const settings = { ...everything, direction: 'rows', order: 'descending' };
    const output = render(settings), starts = runStarts(settings);
    expectSortedRuns(Array.from({ length: size[0] }, (_, x) => luma(output(x, 7))), Array.from({ length: size[0] }, (_, x) => starts(x, 7)), true);
  });

  it('gives all pixels of a band the band colour at their row', () => {
    // Band Width 200 (1080p) is 2.96 pixels of this 16-pixel-tall frame: bands x 0–2, 3–5, 6–8.
    const output = render({ ...everything, bandWidth: 200 });
    for (const y of [0, 9]) for (const start of [0, 6]) {
      const band = [0, 1, 2].map(dx => output(start + dx, y));
      band.slice(1).forEach(pixel => expect(close(pixel, band[0])).toBe(true));
    }
  });

  it('only sorts tones within Range of Centre and keeps alpha', () => {
    // Left half white (outside a narrow dark range), right half dark gradient on half alpha.
    const image = (x: number, y: number): Pixel => x < 12 ? [1, 1, 1, 1] : [y / 40, y / 40, y / 40, 1];
    const output = render({ ...everything, centre: 0.2, range: 0.2 }, image);
    expect(output(3, 5)).toEqual([1, 1, 1, 1]);
    const cut = (x: number, y: number): Pixel => x < 12 ? [0, 0, 0, 0] : [.5, .4, .3, 1];
    const transparent = render(everything, cut);
    expect(transparent(4, 4)[3]).toBe(0);
    expect(transparent(16, 4)[3]).toBe(1);
  });

  it('streaks slant with Tilt: a single bright pixel moves only along its slanted line', () => {
    const image = (x: number, y: number): Pixel => x === 12 && y === 0 ? [1, 1, 1, 1] : [.2, .2, .2, 1];
    const output = render({ ...everything, tilt: 45 }, image);
    // Ascending sort moves the bright pixel to the end of its line: line x − y = 12 ends at (24, 12) outside, so (23, 11).
    expect(luma(output(23, 11))).toBeGreaterThan(.9);
  });

  it('keeps band lines and sort lines together at a fractional Tilt', () => {
    // Bands 3 px wide (Band Width 200 at this frame) at 12.37°: every band holds one flat colour per row, so a
    // band line that disagreed with the sort line would mix two band colours into one row of a band.
    const output = render({ ...everything, tilt: 12.37, bandWidth: 200 });
    const slope = Math.tan(12.37 * Math.PI / 180);
    let checked = 0;
    for (const y of [3, 11]) for (let x = 2; x < 20; x++) {
      const line = (column: number) => column - Math.floor(y * slope + .5);
      if (Math.floor(line(x) / 2.962962962962963) !== Math.floor(line(x + 1) / 2.962962962962963)) continue;
      expect(close(output(x, y), output(x + 1, y), 4e-3)).toBe(true); checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('builds the Layer 2 passes only when Layer 2 is on', () => {
    const passes = (layer2: string) => compileImageOperatorGraph(createDefaultPixelSortBandsGraph(), { ...getDefaultParams('pixel-sort-bands'), layer2 },
      { parameterSchema: getEffect('pixel-sort-bands')!.params }).passes!.filter(pass => pass.segmentSort).map(pass => pass.segmentSort!.settings.axis);
    expect(passes('off')).toEqual(['columns']);
    expect(passes('rows')).toEqual(['columns', 'rows']);
  });

  it('reports values outside the rendered range', () => {
    const warnings = getEffect('pixel-sort-bands')!.paramWarnings!({ ...getDefaultParams('pixel-sort-bands'), progress: 1.4, tilt: 60, bandWidth: 90 });
    expect(warnings.join(' ')).toMatch(/Progress 1.4/);
    expect(warnings.join(' ')).toMatch(/Tilt 60/);
    expect(warnings.join(' ')).toMatch(/64 evenly spaced/);
  });
});
