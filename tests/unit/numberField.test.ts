// Number Field (the glyph engine in a few flat colours): every cell takes one of Steps colours, evenly spaced from
// Dark to Light by its tone. Pure white lands on Light itself (the earlier fixed five steps put it one step past
// Light, at 1.25 of the way); Steps renders as a whole count between 2 and 16 and says when it is clamped; setups
// saved without Steps hide it and keep five steps; the card no longer shows the retired Color Source (the graph kept
// an unconnected node bound to it); with the Numeric ramp and ten steps every figure names its shade.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { ASCII_RAMP_PRESETS } from '../../src/effects/_shared/asciiRamps';
import { planGlyphAtlas } from '../../src/effects/_shared/glyphAtlas';
import { NUMBER_FIELD_STEPS, numberFieldStep } from '../../src/effects/glyph/numberField';
import { paramRangeNotes } from '../../src/effects/paramRangeNotes';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

const RESOLUTION: [number, number] = [1920, 1080];
const NUMERIC = ASCII_RAMP_PRESETS.numeric;

function plan(overrides: Record<string, unknown>, graph?: EffectOperatorGraph) {
  const params: Record<string, unknown> = { ...getDefaultParams('number-field'), amount: 1, background: 0, blackLevel: 0, colorA: '#000000', colorB: '#ffffff', ...overrides };
  const charset = String(params.customRamp || NUMERIC);
  return compileImageOperatorGraph(graph ?? effectOperatorGraph({ type: 'number-field', params: params as Effect['params'] }), params, {
    parameterSchema: getEffect('number-field')!.params, resolveGlyphAtlas: () => ({ fontFamily: 'monospace', fontWeight: 600, charset, cellSize: 64 }) });
}

/** The colour of a fully covered pixel of a cell on a flat grey picture of brightness `tone` (its ink). */
function ink(tone: number, overrides: Record<string, unknown> = {}, graph?: EffectOperatorGraph) {
  const out = evaluateImageOperatorPlan(plan(overrides, graph), [0, 0, 0, 0], { uv: [.5, .5], resolution: RESOLUTION,
    sampleImage: () => [tone, tone, tone, 1], sampleResource: () => [0, 0, 0, 1] }) as number[];
  return out.slice(0, 3);
}

/** The ramp character a cell of brightness `tone` draws, read from where the graph samples the glyph atlas. */
function character(tone: number, overrides: Record<string, unknown>) {
  const atlas = planGlyphAtlas({ fontFamily: 'monospace', fontWeight: 600, charset: NUMERIC, cellSize: 64 });
  let read: [number, number] = [0, 0];
  evaluateImageOperatorPlan(plan(overrides), [0, 0, 0, 0], { uv: [.5, .5], resolution: RESOLUTION, sampleImage: () => [tone, tone, tone, 1],
    sampleResource: (_id, uv) => { read = uv as [number, number]; return [0, 0, 0, 1]; } });
  const column = Math.floor(read[0] * atlas.columns), row = Math.floor(read[1] * atlas.rows);
  return atlas.glyphs[row * atlas.columns + column];
}

describe('Number Field', () => {
  it('has Steps of its own in the Color section and four presets', () => {
    const { params, presets } = getEffect('number-field')!;
    expect(params.steps).toMatchObject({ label: 'Steps', default: NUMBER_FIELD_STEPS, legacyDefault: NUMBER_FIELD_STEPS, min: 2, max: 16, step: 1,
      renderMin: 2, renderMax: 16, group: 'Color', graphOnly: true, lookOwn: true });
    expect(Object.keys(params).filter(key => params[key].group === 'Color' && !params[key].deprecated)).toEqual(['colorA', 'colorB', 'steps']);
    expect(presets?.map(preset => preset.name)).toEqual(['Countdown', 'Paint by Numbers', 'Signal Red', 'Census']);
    for (const preset of presets ?? []) for (const key of ['customRamp', 'blackLevel', 'steps', 'colorA', 'colorB']) expect(preset.params, `${preset.name} ${key}`).toHaveProperty(key);
  });

  it('gives every cell one of Steps flat colours from Dark to Light, pure white exactly Light', () => {
    for (const [tone, expected] of [[0, 0], [.19, 0], [.21, .25], [.5, .5], [.79, .75], [.81, 1], [1, 1]] as const) {
      for (const channel of ink(tone)) expect(channel, `tone ${tone}`).toBeCloseTo(expected, 6);
    }
    // The earlier fixed steps divided five bands by four: white went 1.25 of the way, past Light (here beyond 1).
    const light = [0xe0 / 255, 0xc0 / 255, 0x80 / 255];
    ink(1, { colorA: '#204060', colorB: '#e0c080' }).forEach((channel, index) => expect(channel).toBeCloseTo(light[index], 6));
    for (const [tone, expected] of [[.3, 0], [.5, .5], [.9, 1]] as const) expect(ink(tone, { steps: 3 })[0]).toBeCloseTo(expected, 6);
    for (const tone of [0, .1, .33, .5, .66, .9, 1]) expect(ink(tone, { steps: 7 })[0]).toBeCloseTo(numberFieldStep(tone, 7), 6);
  });

  it('renders Steps as a whole count between 2 and 16 and says when it is clamped', () => {
    for (const tone of [.2, .45, .7, .95]) {
      expect(ink(tone, { steps: 2.6 })[0]).toBeCloseTo(ink(tone, { steps: 3 })[0], 6);
      expect(ink(tone, { steps: 1 })[0]).toBeCloseTo(ink(tone, { steps: 2 })[0], 6);
      expect(ink(tone, { steps: 40 })[0]).toBeCloseTo(ink(tone, { steps: 16 })[0], 6);
    }
    const graph = effectOperatorGraph({ type: 'number-field', params: getDefaultParams('number-field') });
    expect(paramRangeNotes(getEffect('number-field')!.params, { steps: 1 }, graph).map(note => note.message)).toEqual([
      'Steps 1 is below the rendered range (2 to 16) and renders as 2.',
    ]);
    expect(paramRangeNotes(getEffect('number-field')!.params, { steps: 40 }, graph).map(note => note.message)).toEqual([
      'Steps 40 is above the rendered range (2 to 16) and renders as 16.',
    ]);
  });

  it('shows Dark, Light and Steps in the card but not the retired Color Source it never reads', () => {
    // The shared graph used to keep an unconnected Color Source node, so the card showed a control that did nothing.
    const definitions = effectParamDefinitions({ type: 'number-field', params: getDefaultParams('number-field') });
    expect(definitions.colorMode.hidden).toBe(true);
    for (const key of ['colorA', 'colorB', 'steps']) expect(definitions[key].hidden, key).toBeFalsy();
    expect(effectOperatorGraph({ type: 'number-field', params: getDefaultParams('number-field') }).nodes.some(node => node.id === 'color-mode')).toBe(false);
  });

  it('a node setup saved without Steps hides it in the card and keeps five steps', () => {
    const graph = structuredClone(effectOperatorGraph({ type: 'number-field', params: getDefaultParams('number-field') }));
    graph.nodes.find(node => node.id === 'tone-steps')!.bindings = {};
    expect(effectParamDefinitions({ type: 'number-field', params: getDefaultParams('number-field'), operatorGraph: graph }).steps.hidden).toBe(true);
    for (const tone of [.15, .3, .55, .85]) expect(ink(tone, { steps: 2 }, graph)[0]).toBeCloseTo(numberFieldStep(tone, 5), 6);
  });

  it('with the Numeric ramp and ten steps every figure names its own shade (Census)', () => {
    for (let band = 0; band < 10; band += 1) {
      const tone = (band + .5) / 10;
      expect(character(tone, { steps: 10 }), `band ${band}`).toBe(NUMERIC[band]);
      expect(ink(tone, { steps: 10 })[0]).toBeCloseTo(band / 9, 6);
    }
  });
});
