// Posterize Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { POSTERIZE_PARAMS } from '../pointwiseParams';
import { posterizeParamNotes } from '../pointwiseModel';

/** From two tones to fine bands. Every preset names Brightness Only: its stored default is off
 * (what saved Posterize effects mean), while a new Posterize starts with it on. */
export const POSTERIZE_PRESETS: readonly EffectPreset[] = [
  // Two tones: light parts keep their colour at full strength, everything darker drops to black.
  { id: 'stencil', name: 'Stencil', params: { levels: 2, softness: 0.1, brightnessOnly: true } },
  // A few flat inks with rounded edges, like a hand-pulled screen print.
  { id: 'screen-print', name: 'Screen Print', params: { levels: 4, softness: 0.35, brightnessOnly: true } },
  // Each channel on its own in two steps: eight loud primaries, like a pop-art print.
  { id: 'pop-art', name: 'Pop Art', params: { levels: 2, softness: 0.1, brightnessOnly: false } },
  // Eight hard brightness bands: soft light and haze turn into rings, like the lines of a relief map.
  { id: 'banded-light', name: 'Banded Light', params: { levels: 8, softness: 0, brightnessOnly: true } },
];

export const posterize: EffectDefinition = {
  id: 'posterize',
  name: 'Posterize',
  category: 'stylize',

  shader,
  entryPoint: 'posterizeFragment',
  uniformSize: 16,

  params: POSTERIZE_PARAMS,

  presets: POSTERIZE_PRESETS,

  paramWarnings: (params) => posterizeParamNotes(params),

  packUniforms: (params) => {
    return new Float32Array([
      params.levels as number ?? 6,
      0, 0, 0,
    ]);
  },
};
