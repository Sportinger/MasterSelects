// Hue Shift Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { HUE_SHIFT_PARAMS } from '../remainingColorParams';

/** Turns round the colour wheel, from a slight shift to the opposite colours (Shift in turns, 1 = 360°). */
export const HUE_SHIFT_PRESETS: readonly EffectPreset[] = [
  // A small step back (-20°): orange light turns rosier, a blue sky and sea lean towards turquoise.
  { id: 'slight-shift', name: 'Slight Shift', params: { shift: -1 / 18 } },
  // A third of the wheel forward (120°): warm light and skin turn green, blue turns red.
  { id: 'third-turn', name: 'Third Turn', params: { shift: 1 / 3 } },
  // Half the wheel (180°): every colour becomes its opposite; warm stage light turns cold blue.
  { id: 'half-turn', name: 'Half Turn', params: { shift: 0.5 } },
  // A third of the wheel back (-120°): warm light and skin turn violet, blue turns green.
  { id: 'third-turn-back', name: 'Third Turn Back', params: { shift: -1 / 3 } },
];

export const hueShift: EffectDefinition = {
  id: 'hue-shift',
  name: 'Hue Shift',
  category: 'color',

  shader,
  entryPoint: 'hueShiftFragment',
  uniformSize: 16,

  params: HUE_SHIFT_PARAMS,

  presets: HUE_SHIFT_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.shift as number ?? 0,
      0, 0, 0, // padding
    ]);
  },
};
