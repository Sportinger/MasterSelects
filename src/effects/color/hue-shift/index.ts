// Hue Shift Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { HUE_SHIFT_PARAMS } from '../remainingColorParams';

/** Turns round the colour wheel, from a small nudge to the opposite colours (Shift in turns, 1 = 360°). */
export const HUE_SHIFT_PRESETS: readonly EffectPreset[] = [
  // A small step back (340°): orange light turns rosier, a blue sky and sea lean towards turquoise.
  { id: 'nudge', name: 'Nudge', params: { shift: 17 / 18 } },
  // A third of the wheel (120°): red towards green, green towards blue, blue towards red.
  { id: 'third-turn', name: 'Third Turn', params: { shift: 1 / 3 } },
  // Half the wheel (180°): every colour becomes its opposite; warm stage light turns cold blue.
  { id: 'opposite', name: 'Opposite', params: { shift: 0.5 } },
  // Two thirds (240°): the other triad, red towards blue, blue towards green.
  { id: 'two-thirds', name: 'Two Thirds', params: { shift: 2 / 3 } },
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
