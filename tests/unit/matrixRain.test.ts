// Matrix Rain (the glyph engine's falling code): drops with a near-white head and a fading trail fall down every
// column, the picture sets how brightly the rain glows, Trail and Rain Color act and render clamped, Speed 0 freezes
// the rain, and node setups saved without the new controls hide them.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { MATRIX_DEFAULT_TRAIL, MATRIX_RAIN_COLOR } from '../../src/effects/glyph/matrixRain';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';

type Rgba = [number, number, number, number];

/** One pixel of Matrix Rain on a flat grey picture of the given brightness, every cell drawn full (coverage 1). */
// One compiled plan per set of values: the sweeps below render ~100 frames each, and compiling per frame timed out on a busy machine.
const plans = new Map<string, ReturnType<typeof compileImageOperatorGraph>>();
function render(overrides: Record<string, unknown>, time: number, options: { uv?: [number, number]; grey?: number; picture?: (uv: [number, number]) => Rgba; coverage?: number } = {}) {
  const key = JSON.stringify(overrides);
  let plan = plans.get(key);
  if (!plan) {
    const params: Record<string, unknown> = { ...getDefaultParams('matrix'), background: 0, amount: 1, ...overrides };
    plan = compileImageOperatorGraph(effectOperatorGraph({ type: 'matrix', params: params as Effect['params'] }), params, {
      parameterSchema: getEffect('matrix')!.params, resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset: ' .#@', cellSize: 64 }) });
    plans.set(key, plan);
  }
  const grey = options.grey ?? .5, source: Rgba = [grey, grey, grey, 1];
  return evaluateImageOperatorPlan(plan, [0, 0, 0, 0], { uv: options.uv ?? [.31, .47], resolution: [1920, 1080], timelineTimeSeconds: time,
    sampleImage: options.picture ?? (() => source), sampleResource: () => [0, 0, 0, options.coverage ?? 1] }) as number[];
}

const times = Array.from({ length: 96 }, (_, index) => index / 24);

describe('Matrix Rain', () => {
  it('has its own Rain Color and Trail, hides the shared colours and starts near the character of each cell', () => {
    const { params } = getEffect('matrix')!;
    expect(params.rainColor).toMatchObject({ type: 'color', label: 'Rain Color', default: MATRIX_RAIN_COLOR, group: 'Color', graphOnly: true });
    expect(params.trail).toMatchObject({ label: 'Trail', default: MATRIX_DEFAULT_TRAIL, min: 0, max: 1, renderMin: 0, renderMax: 1, group: 'Motion', graphOnly: true, animatable: true });
    expect(Object.keys(params).filter(key => params[key].group === 'Motion')).toEqual(['speed', 'roll', 'trail']);
    for (const key of ['colorMode', 'colorA', 'colorB']) expect(params[key].deprecated, key).toMatch(/own colours/);
    expect(getDefaultParams('matrix')).toMatchObject({ rampPreset: 'numeric', roll: .5, background: .3, trail: .5 });
  });

  it('lets drops fall: a cell lights up as a head passes, fades along the trail and goes dark until the next drop', () => {
    const green = times.map(time => render({}, time)[1]);
    expect(Math.max(...green)).toBeGreaterThan(.5);
    expect(Math.min(...green)).toBe(0);
    // The head turns towards white: red and blue rise well above the Rain Color's share at the brightest moment.
    const brightest = render({}, times[green.indexOf(Math.max(...green))]);
    expect(brightest[0] / brightest[1]).toBeGreaterThan(.5);
    // Down the column the same drop arrives later: the first lit moment of a lower cell comes after the upper one's.
    const firstLit = (v: number) => times.find(time => render({ speed: .25 }, time, { uv: [.31, v] })[1] > 0)!;
    const upper = firstLit(.47), lower = firstLit(.47 + 3 / 77);
    expect(lower).toBeGreaterThan(upper);
  });

  it('glows with the picture: a bright picture lights the trails more than a dark one', () => {
    const mean = (grey: number) => times.reduce((sum, time) => sum + render({}, time, { grey })[1], 0) / times.length;
    expect(mean(.9)).toBeGreaterThan(mean(.1) * 3);
  });

  it('flashes the head whatever the picture, and Black Level clears the heads on the dark stage', () => {
    const brightest = (grey: number, overrides: Record<string, unknown> = {}) => Math.max(...times.map(time => render(overrides, time, { grey })[1]));
    // On a dark stage (tone 0.1) the head still lights near full, not at a quarter as when it followed the tone.
    expect(brightest(.1)).toBeGreaterThan(.75);
    // Below Black Level the stage goes dark, heads included.
    expect(brightest(.1, { blackLevel: .2 })).toBeLessThan(.1);
  });

  it('lays a smooth glow of the picture behind the code, without cell steps', () => {
    // A ramp from dark (left) to bright (right), no trails and still rain: what remains between the heads is the ground.
    const ramp = (uv: [number, number]): Rgba => [uv[0], uv[0], uv[0], 1];
    const row = Array.from({ length: 43 }, (_, index) => render({ background: 1, trail: 0, speed: 0, cellSize: 14 },
      0, { uv: [(900 + index) / 1920, .5], picture: ramp })[1]);
    const steps = row.slice(1).map((value, index) => value - row[index]);
    // Every pixel brightens a little: over three cells there is no flat stretch and no jump at a cell border.
    expect(steps.filter(step => step > 0).length).toBeGreaterThan(36);
    expect(Math.max(...steps)).toBeLessThan(4 * (row[42] - row[0]) / 42);
  });

  it('Trail sets how long the lit tail is, renders clamped outside 0 to 1 and says so', () => {
    const litShare = (trail: number) => times.filter(time => render({ trail, speed: .5 }, time)[1] > 0).length / times.length;
    expect(litShare(1)).toBeGreaterThan(litShare(.5));
    expect(litShare(.5)).toBeGreaterThan(litShare(0));
    expect(litShare(0)).toBeGreaterThan(0);
    expect(times.map(time => render({ trail: 3 }, time)[1])).toEqual(times.map(time => render({ trail: 1 }, time)[1]));
    expect(paramRangeNotes(getEffect('matrix')!.params, { trail: 3 }, effectOperatorGraph({ type: 'matrix', params: getDefaultParams('matrix') }))[0].message)
      .toBe('Trail 3 is above the rendered range (0 to 1) and renders as 1.');
  });

  it('draws in its Rain Color', () => {
    const red = times.map(time => render({ rainColor: '#ff0000' }, time));
    const tail = red.find(pixel => pixel[0] > .1 && pixel[1] < .05);
    expect(tail).toBeDefined();
  });

  it('Speed 0 freezes the rain and the characters', () => {
    expect(times.map(time => render({ speed: 0 }, time))).toEqual(times.map(() => render({ speed: 0 }, 0)));
  });

  it('lights the glow behind the code evenly down a column as a trail passes, not in steps of whole rows', () => {
    // No characters (coverage 0), a flat picture: what remains is the glow, brighter towards each head.
    const column = Array.from({ length: 77 }, (_, index) => render({ background: 1, trail: 1, speed: 1 }, .7,
      { uv: [.31, (300 + index) / 1080], coverage: 0 })[1]);
    const steps = column.slice(1).map((value, index) => Math.abs(value - column[index])).toSorted((a, b) => b - a);
    // Over about five rows, at most two jumps (where a head passes); every other pixel changes only a little.
    expect(Math.max(...column) - Math.min(...column)).toBeGreaterThan(.02);
    expect(steps[2]).toBeLessThan((Math.max(...column) - Math.min(...column)) / 8);
  });

  it('keeps every stage folder in the Nodes tab (a cable running back between two folders would dissolve them)', () => {
    const labels = (type: string) => (effectOperatorGraph({ type, params: getDefaultParams(type) }).groups ?? []).map(group => group.label);
    expect(labels('matrix')).toEqual(expect.arrayContaining(['Cell Grid', 'Cell Sampling & Tone', 'Rain', 'Glow', 'Glyph Offset', 'Roll Window', 'Ink & Appearance']));
    expect(labels('grid-glyph')).toEqual(expect.arrayContaining(['Cell Grid', 'Cell Sampling & Tone', 'Grid Lines', 'Ink & Appearance']));
    expect(labels('number-field')).toEqual(expect.arrayContaining(['Cell Grid', 'Cell Sampling & Tone', 'Color Steps', 'Ink & Appearance']));
    expect(labels('pixel-code')).toEqual(expect.arrayContaining(['Cell Grid', 'Cell Sampling & Tone', 'Scramble', 'Ink & Appearance']));
  });

  it('a node setup saved without Trail or Rain Color hides them in the card', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'matrix', params: getDefaultParams('matrix') }));
    for (const id of ['trail', 'rain-color']) graph.nodes.find(node => node.id === id)!.bindings = {};
    const definitions = effectParamDefinitions({ type: 'matrix', params: getDefaultParams('matrix'), operatorGraph: graph });
    expect(definitions.trail.hidden).toBe(true);
    expect(definitions.rainColor.hidden).toBe(true);
  });
});
