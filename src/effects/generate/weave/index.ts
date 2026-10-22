// Weave: procedural strands built from general curve and math nodes. The graph lives on
// `effect.operatorGraph` (domain `geometry`); the 2D stack skips it (see layerEffectStack). Without an
// edited graph, Form picks the recipe graph (weaveRecipeGraph in services/operators/geometry/weaveGraph.ts);
// the card controls are the parameters those recipes bind. The keys ending in `_value` are the
// recipes' exposed Value nodes, so saved graphs, keyframes and node drivers keep working.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../../types';
import { generatorChoiceWarnings } from '../generatorParams';

const CLOTH_ONLY = { param: 'form', values: ['cloth'], note: 'Acts on the Woven Cloth form only.' } as const;
const QUALLE_ONLY = { param: 'form', values: ['qualle'], note: 'Acts on the Qualle form only.' } as const;
const number = (label: string, value: number, min: number, max: number, step: number, group: string,
  activeWhen: EffectParam['activeWhen'], unit?: string): EffectParam =>
  ({ type: 'number', label, default: value, min, max, step, animatable: true, group, graphOnly: true, activeWhen, ...(unit ? { unit } : {}) });

/** Weave's card. Defaults equal the recipe graphs' own node values (tests/unit/weaveForms.test.ts). */
export const WEAVE_PARAMS: Record<string, EffectParam> = {
  form: { type: 'select', label: 'Form', default: 'cloth', animatable: false, graphOnly: true,
    options: [{ value: 'cloth', label: 'Woven Cloth' }, { value: 'qualle', label: 'Qualle' }] },
  color: { type: 'color', label: 'Color', default: '#8a857c', graphOnly: true },
  weave_value: number('Weave Speed', 1, 0, 10, 0.05, 'Weave In', CLOTH_ONLY),
  reveal_value: number('Reveal', 1, 0, 1, 0.01, 'Reveal by Shape', CLOTH_ONLY),
  irregularity_value: number('Irregularity', 1, 0, 3, 0.01, 'Handmade', CLOTH_ONLY),
  wind: number('Wind', 0.35, 0, 2, 0.01, 'Wind Cloth', CLOTH_ONLY),
  'pulse-rate_value': number('Pulse Rate', 0.4, 0, 2, 0.01, 'Jellyfish Pulse', QUALLE_ONLY, ' Hz'),
  'pulse-strength_value': number('Pulse Size', 0.54, 0, 0.6, 0.01, 'Jellyfish Pulse', QUALLE_ONLY),
  'curl-strength_value': number('Curl Strength', 0.063, 0, 0.25, 0.001, 'Return Curls', QUALLE_ONLY),
};

/** Named starting points of the card (values that differ from the defaults). */
export const WEAVE_PRESETS: readonly EffectPreset[] = [
  // Pale, coarse yarn in a crooked weave whose corners have frayed away: a rough piece of burlap.
  { id: 'burlap', name: 'Burlap', params: { color: '#d9d2c4', weave_value: 1.5, reveal_value: 0.6, irregularity_value: 2.8, wind: 0.6 } },
  // An even, deep red cloth that bows and sways in strong gusts.
  { id: 'red-sail', name: 'Red Sail', params: { color: '#b0261e', weave_value: 2, irregularity_value: 0.4, wind: 2 } },
  // Only a round patch grows, very uneven, in brown wool with a swollen, frayed rim: a bird's nest.
  { id: 'nest', name: 'Nest', params: { color: '#7d5b3a', weave_value: 2, reveal_value: 0.32, irregularity_value: 2.5, wind: 0.2 } },
  // Roman's jellyfish: a knitted bell with long cream ribbons that pulse and curl.
  { id: 'qualle', name: 'Qualle', params: { form: 'qualle', color: '#eee2cf' } },
];

/** What a value beyond a card range does (tools may set one): said, not left to surprise. */
const RANGE_NOTES: Record<string, { below?: string; above?: string }> = {
  weave_value: { below: 'a negative Weave Speed never weaves anything in, so the sheet stays empty' },
  irregularity_value: { below: 'Irregularity acts squared, so a negative value looks like the same positive one',
    above: 'above 3 the threads bunch into knots and leave large holes' },
  wind: { below: 'a negative Wind blows the sheet backwards, away from the camera',
    above: 'above 2 the wind blows the sheet out of shape and beyond the frame' },
  'curl-strength_value': { below: 'a negative Curl Strength curls the ribbons the other way',
    above: 'above 0.25 the ribbons swirl past the edges of the frame' },
  reveal_value: { below: 'below 0 nothing is drawn', above: 'above 1 the net is already whole, so it changes nothing more' },
  'pulse-rate_value': { below: 'a negative Pulse Rate runs the pulse backwards' },
  'pulse-strength_value': { below: 'a negative Pulse Size swells the bell outwards instead of drawing it in',
    above: 'above 0.6 the bell folds through itself and turns inside out' },
};
function weaveRangeNotes(params: Record<string, number | boolean | string>): string[] {
  return Object.entries(RANGE_NOTES).flatMap(([key, note]) => {
    const value = params[key], definition = WEAVE_PARAMS[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || definition.min === undefined || definition.max === undefined) return [];
    const text = value < definition.min ? note.below : value > definition.max ? note.above : undefined;
    return text ? [`${definition.label} ${value} is outside its range ${definition.min} to ${definition.max}: ${text}.`] : [];
  });
}

export const weave: EffectDefinition = {
  id: 'weave',
  name: 'Weave',
  category: 'generate',
  shader,
  entryPoint: 'weaveFragment',
  uniformSize: 0,
  params: WEAVE_PARAMS,
  presets: WEAVE_PRESETS,
  // The weave-in, the wind and the pulse follow the playhead and hold while paused (docs show loops).
  timelineAnimated: true,
  paramWarnings: params => [...generatorChoiceWarnings(WEAVE_PARAMS, params, ['form']), ...weaveRangeNotes(params)],
  packUniforms: () => null,
};
