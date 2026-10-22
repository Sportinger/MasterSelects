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
  'curl-strength_value': number('Curl Strength', 0.063, 0, 0.5, 0.001, 'Return Curls', QUALLE_ONLY),
};

/** Named starting points of the card (values that differ from the defaults). */
export const WEAVE_PRESETS: readonly EffectPreset[] = [
  // Deep red yarn, woven slowly and unevenly, like a hand-made net.
  { id: 'red-thread', name: 'Red Thread', params: { color: '#a3201c', weave_value: 0.75, irregularity_value: 1.6 } },
  // Pale, even linen that hardly moves: a calm, precise grid.
  { id: 'linen-grid', name: 'Linen Grid', params: { color: '#ece4d2', irregularity_value: 0, wind: 0.08 } },
  // Only a round patch grows, very uneven, in brown wool with a swollen, frayed rim: a bird's nest.
  { id: 'nest', name: 'Nest', params: { color: '#7d5b3a', weave_value: 2, reveal_value: 0.32, irregularity_value: 2.5, wind: 0.2 } },
  // Roman's jellyfish: a knitted bell with long cream ribbons that pulse and curl.
  { id: 'qualle', name: 'Qualle', params: { form: 'qualle', color: '#eee2cf' } },
];

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
  paramWarnings: params => generatorChoiceWarnings(WEAVE_PARAMS, params, ['form']),
  packUniforms: () => null,
};
