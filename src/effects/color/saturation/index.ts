// Saturation Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { SATURATION_AMOUNT_PARAM } from '../sharedColorAmountParams';

/** Starting points from black and white to vivid; every colour keeps its hue and brightness. */
export const SATURATION_PRESETS: readonly EffectPreset[] = [
  // Pure black and white from the Rec.709 brightness of each pixel.
  { id: 'black-and-white', name: 'Black & White', params: { amount: 0 } },
  // Only a memory of colour: an old photograph, a flashback.
  { id: 'faded', name: 'Faded', params: { amount: 0.3 } },
  // Fuller colour for dull or washed-out footage without a garish look.
  { id: 'rich', name: 'Rich', params: { amount: 1.35 } },
  // Strong colour; every colour stops at its strongest version instead of clipping.
  { id: 'vivid', name: 'Vivid', params: { amount: 1.8 } },
];

export const saturation: EffectDefinition = {
  id: 'saturation',
  name: 'Saturation',
  category: 'color',

  shader,
  entryPoint: 'saturationFragment',
  uniformSize: 16,

  params: {
    amount: SATURATION_AMOUNT_PARAM,
  },

  presets: SATURATION_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
