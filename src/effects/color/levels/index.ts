// Levels Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { LEVELS_PARAMS } from '../remainingColorParams';

/** Tonal starting points: clean black and white points, open or heavy mid-tones, and a matte print. */
export const LEVELS_PRESETS: readonly EffectPreset[] = [
  // The darkest 6 % become black and the brightest 6 % white: a clean, firmer picture.
  { id: 'clean-points', name: 'Clean Points', params: { inputBlack: 0.06, inputWhite: 0.94 } },
  // Lighter mid-tones while black and white stay: the haze and the skin open up.
  { id: 'open-mids', name: 'Open Mids', params: { gamma: 1.4 } },
  // Heavier mid-tones on a slightly deeper black: a darker, denser mood.
  { id: 'deep-mids', name: 'Deep Mids', params: { inputBlack: 0.04, gamma: 0.6 } },
  // Blacks lifted to a dark grey and whites held below white, like a matte film print.
  { id: 'matte-film', name: 'Matte Film', params: { outputBlack: 0.12, outputWhite: 0.9 } },
];

export const levels: EffectDefinition = {
  id: 'levels',
  name: 'Levels',
  category: 'color',

  shader,
  entryPoint: 'levelsFragment',
  uniformSize: 32, // 8 floats

  params: LEVELS_PARAMS,

  presets: LEVELS_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.inputBlack as number ?? 0,
      params.inputWhite as number ?? 1,
      params.gamma as number ?? 1,
      params.outputBlack as number ?? 0,
      params.outputWhite as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
