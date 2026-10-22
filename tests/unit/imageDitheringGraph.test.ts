// Dithering (createDefaultDitheringGraph): big pixels of Pixel Size, each read as one colour in linear light, stepped
// to Levels per channel by the cell's 4 × 4 Bayer threshold with the share of the upper step in linear light.
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { dither } from '../../src/effects/halftone';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { createDefaultDitheringGraph, DITHER_ALPHA_FLOOR, DITHER_TAPS } from '../../src/services/operators/ditheringEffectGraph';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { linearToSrgb, srgbToLinear } from '../../src/services/operators/imageColorSpaceSemantics';
import { compileImageOperatorGraph, evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { roundImageScalarEven } from '../../src/services/operators/imageRoundingSemantics';

type Rgba = [number, number, number, number];
type Params = { scale: number; levels: number; amount: number };
type Sample = (uv: [number, number]) => Rgba;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer4 = ([x, y]: [number, number]) => (BAYER[(Math.floor(y) % 4) * 4 + Math.floor(x) % 4] + .5) / 16;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const FULL_HD: [number, number] = [1920, 1080];

/** The recipe in plain arithmetic (straight colour, as the image graphs sample it). */
function reference(uv: [number, number], resolution: [number, number], params: Params, sample: Sample): Rgba {
  const size = Math.max(roundImageScalarEven(Math.max(params.scale, 1) * Math.min(...resolution) / 1080), 1);
  const cells: [number, number] = [uv[0] * resolution[0] / size, uv[1] * resolution[1] / size];
  const center = cells.map(value => (Math.floor(value) + .5) * size), reach = Math.min(size * .25, (size - 1) * .5);
  const read = (point: [number, number]) => sample([clamp(point[0], .001, .999), clamp(point[1], .001, .999)]);
  let light = [0, 0, 0], alpha = 0;
  for (const [x, y] of DITHER_TAPS) {
    const tap = read([(center[0] + x * reach) / resolution[0], (center[1] + y * reach) / resolution[1]]);
    light = light.map((value, c) => value + srgbToLinear(tap[c]) * tap[3]); alpha += tap[3];
  }
  const own = read(uv), steps = Math.max(params.levels, 2) - 1, threshold = bayer4(cells);
  const dithered = [0, 1, 2].map(c => {
    const cell = clamp(alpha <= DITHER_ALPHA_FLOOR ? srgbToLinear(own[c]) : light[c] / Math.max(alpha, DITHER_ALPHA_FLOOR), 0, 1);
    const lowerIndex = Math.floor(linearToSrgb(cell) * steps), lower = lowerIndex / steps, upper = clamp((lowerIndex + 1) / steps, 0, 1);
    const share = (cell - srgbToLinear(lower)) / Math.max(srgbToLinear(upper) - srgbToLinear(lower), 1e-6);
    return clamp((lowerIndex + Math.floor(share + threshold)) / steps, 0, 1);
  });
  return [...dithered.map((value, c) => own[c] * (1 - params.amount) + value * params.amount), own[3]] as Rgba;
}

const plans = new Map<string, ImageOperatorPlan>();
function render(params: Partial<Params>, uv: [number, number], resolution: [number, number], sample: Sample): Rgba {
  const values = { ...getDefaultParams('dither'), ...params }, key = JSON.stringify(values);
  let plan = plans.get(key);
  if (!plan) { plan = compileImageOperatorGraph(createDefaultDitheringGraph(), values, { parameterSchema: dither.params }); plans.set(key, plan); }
  return evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv, resolution, sampleImage: sample }) as Rgba;
}
const flat = (color: Rgba): Sample => () => color;
/** UV of the centre of pixel (x, y). */
const at = (x: number, y: number, resolution: [number, number] = FULL_HD): [number, number] => [(x + .5) / resolution[0], (y + .5) / resolution[1]];
const picture: Sample = ([u, v]) => [.5 + .45 * Math.sin(u * 23 + v * 7), .5 + .45 * Math.sin(v * 17 - u * 5), clamp(u * .9 + .05, 0, 1), .25 + .75 * clamp(v * 1.3, 0, 1)];

describe('Dithering image graph', () => {
  it('binds Pixel Size, Levels and Amount to the effect parameters', () => {
    const graph = createDefaultDitheringGraph();
    for (const id of ['scale', 'levels', 'amount']) expect(graph.nodes.find(node => node.id === id)?.bindings).toEqual({ value: id });
  });

  it('matches the reference at every cell size, level count and amount, with alpha', () => {
    const cases: Array<[Partial<Params>, [number, number]]> = [
      [{}, FULL_HD], [{ scale: 1, levels: 2 }, FULL_HD], [{ scale: 8, levels: 6, amount: .6 }, FULL_HD],
      [{ scale: 24, levels: 16 }, [3840, 2160]], [{ scale: 5, levels: 5.5 }, [1280, 720]], [{ scale: 3, levels: 3 }, [1080, 1920]],
    ];
    for (const [params, resolution] of cases) for (const point of [[.137, .421], [.5, .5], [.871, .093], [.004, .996]] as [number, number][]) {
      const actual = render(params, point, resolution, picture), expected = reference(point, resolution, { ...getDefaultParams('dither'), ...params } as Params, picture);
      expected.forEach((value, index) => expect(actual[index], `${JSON.stringify(params)} at ${point}`).toBeCloseTo(value, 5));
    }
  });

  it('keeps black black and white white at every Levels and on every Bayer threshold', () => {
    for (const levels of [2, 3, 4, 5.5, 8, 16]) for (let y = 0; y < 12; y += 3) for (let x = 0; x < 12; x += 3) {
      expect(render({ levels }, at(x, y), FULL_HD, flat([0, 0, 0, 1])).slice(0, 3), `black at levels ${levels}`).toEqual([0, 0, 0]);
      render({ levels }, at(x, y), FULL_HD, flat([1, 1, 1, 1])).slice(0, 3).forEach(value => expect(value, `white at levels ${levels}`).toBeCloseTo(1, 6));
    }
  });

  it('keeps the picture light: over one Bayer tile the dithered light is the cell light within a 32nd of a step', () => {
    for (const levels of [2, 4, 7]) for (let grey = 0; grey <= 1.0001; grey += .05) {
      const steps = levels - 1, linear = srgbToLinear(grey);
      const lower = Math.floor(grey * steps) / steps, span = srgbToLinear(Math.min(lower + 1 / steps, 1)) - srgbToLinear(lower);
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += srgbToLinear(render({ scale: 1, levels }, at(x, y), FULL_HD, flat([grey, grey, grey, 1]))[0]);
      expect(Math.abs(sum / 16 - linear), `grey ${grey.toFixed(2)} at levels ${levels}`).toBeLessThanOrEqual(span / 32 + 1e-6);
    }
  });

  it('gives every pixel of a cell one colour', () => {
    // Pixel Size 8 at 1080p: the cell from (16, 24) to (24, 32).
    const colors = new Set<string>();
    for (let y = 24; y < 32; y++) for (let x = 16; x < 24; x++) colors.add(render({ scale: 8 }, at(x, y), FULL_HD, picture).slice(0, 3).map(value => value.toFixed(6)).join());
    expect(colors.size).toBe(1);
  });

  it('reads a cut-out edge from its opaque points only, and a pixel whose reads are all transparent from itself', () => {
    const color: Rgba = [.7, .45, .3, 1], cutAt = 963 / 1920;
    // Cell 120 of Pixel Size 8 spans x 960–968 and reads x 962 and 966: left of 963 the picture is transparent black.
    const cutOut: Sample = ([u]) => u < cutAt ? [0, 0, 0, 0] : color;
    for (const y of [0, 1, 5]) expect(render({ scale: 8 }, at(965, y), FULL_HD, cutOut)).toEqual(render({ scale: 8 }, at(965, y), FULL_HD, flat(color)));
    // A one-pixel line at x 963 between the reads: it keeps its own colour instead of turning black.
    const line: Sample = ([u]) => Math.floor(u * 1920) === 963 ? color : [0, 0, 0, 0];
    for (const y of [0, 1, 5]) expect(render({ scale: 8 }, at(963, y), FULL_HD, line)).toEqual(render({ scale: 8 }, at(963, y), FULL_HD, flat(color)));
  });

  it('acts on Levels, renders Levels below 2 as 2 and says so', () => {
    const differ = [[.31, .52], [.7, .2], [.45, .83]].some(point => render({ levels: 2 }, point as [number, number], FULL_HD, picture).join() !== render({ levels: 16 }, point as [number, number], FULL_HD, picture).join());
    expect(differ).toBe(true);
    for (const point of [[.31, .52], [.7, .2]] as [number, number][]) expect(render({ levels: 1 }, point, FULL_HD, picture)).toEqual(render({ levels: 2 }, point, FULL_HD, picture));
    expect(paramRangeNotes(dither.params, { levels: 1 }, createDefaultDitheringGraph()).map(note => note.message))
      .toEqual(['Levels 1 is below the rendered minimum (2) and renders as 2.']);
  });

  it('keeps a Dithering saved before Levels on its earlier recipe, with Levels hidden', () => {
    const saved = { type: 'dither', params: { scale: 3, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc' } };
    expect(effectOperatorGraph(saved).nodes.some(node => node.id === 'quantize-four')).toBe(true);
    expect(effectParamDefinitions(saved).levels.hidden).toBe(true);
    const added = { type: 'dither', params: getDefaultParams('dither') };
    expect(effectOperatorGraph(added).nodes.some(node => node.id === 'share')).toBe(true);
    expect(effectParamDefinitions(added).levels.hidden).toBeFalsy();
    expect(getDefaultParams('dither')).toMatchObject({ scale: 3, levels: 4, amount: 1 });
    // The card says why Levels is missing and the presets do not give the new look.
    expect(dither.paramWarnings?.(saved.params, 1920, 1080).join(' ')).toMatch(/saved before Levels and keeps its earlier look/u);
    expect(dither.paramWarnings?.(getDefaultParams('dither'), 1920, 1080)).toEqual([]);
  });

  it('hands Levels to the shader twin in the variant slot', () => {
    expect(dither.packUniforms({ ...getDefaultParams('dither'), levels: 6 }, 64, 36)![7]).toBe(6);
    expect(dither.packUniforms({ scale: 3, amount: .75 }, 64, 36)![7]).toBe(4);
  });
});
