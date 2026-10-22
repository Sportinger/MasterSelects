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
function render(overrides: Record<string, unknown>, time: number, options: { uv?: [number, number]; grey?: number } = {}) {
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
    sampleImage: () => source, sampleResource: () => [0, 0, 0, 1] }) as number[];
}

const times = Array.from({ length: 96 }, (_, index) => index / 24);

describe('Matrix Rain', () => {
  it('has its own Rain Color and Trail, hides the shared colours and starts near the character of each cell', () => {
    const { params } = getEffect('matrix')!;
    expect(params.rainColor).toMatchObject({ type: 'color', label: 'Rain Color', default: MATRIX_RAIN_COLOR, group: 'Color', graphOnly: true });
    expect(params.trail).toMatchObject({ label: 'Trail', default: MATRIX_DEFAULT_TRAIL, min: 0, max: 1, renderMin: 0, renderMax: 1, group: 'Motion', graphOnly: true, animatable: true });
    expect(Object.keys(params).filter(key => params[key].group === 'Motion')).toEqual(['speed', 'roll', 'trail']);
    for (const key of ['colorMode', 'colorA', 'colorB']) expect(params[key].deprecated, key).toMatch(/own colours/);
    expect(getDefaultParams('matrix')).toMatchObject({ rampPreset: 'numeric', roll: .5, background: .2, trail: .5 });
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

  it('glows with the picture: a bright picture lights the rain more than a dark one', () => {
    const lit = (grey: number) => Math.max(...times.map(time => render({}, time, { grey })[1]));
    expect(lit(.9)).toBeGreaterThan(lit(.1) * 3);
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

  it('a node setup saved without Trail or Rain Color hides them in the card', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'matrix', params: getDefaultParams('matrix') }));
    for (const id of ['trail', 'rain-color']) graph.nodes.find(node => node.id === id)!.bindings = {};
    const definitions = effectParamDefinitions({ type: 'matrix', params: getDefaultParams('matrix'), operatorGraph: graph });
    expect(definitions.trail.hidden).toBe(true);
    expect(definitions.rainColor.hidden).toBe(true);
  });
});
