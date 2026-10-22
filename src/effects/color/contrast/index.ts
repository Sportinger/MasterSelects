// Contrast Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { CONTRAST_AMOUNT_PARAM } from '../sharedColorAmountParams';

/** Starting points from a faded veil to bold punch; black and white stay put above 1. */
export const CONTRAST_PRESETS: readonly EffectPreset[] = [
  // A little more depth for flat or slightly hazy footage; hardly noticed as an effect.
  { id: 'gentle-punch', name: 'Gentle Punch', params: { amount: 1.2 } },
  // Deep shadows and bright highlights: a projection that reads from the back row.
  { id: 'bold', name: 'Bold', params: { amount: 1.5 } },
  // Lifted blacks and softer whites, like an old print.
  { id: 'faded-print', name: 'Faded Print', params: { amount: 0.75 } },
  // Flat and pale, as seen through a gauze or thick haze.
  { id: 'gauze', name: 'Gauze', params: { amount: 0.45 } },
];

export const contrast: EffectDefinition = {
  id: 'contrast',
  name: 'Contrast',
  category: 'color',

  shader,
  entryPoint: 'contrastFragment',
  uniformSize: 16,

  params: {
    amount: CONTRAST_AMOUNT_PARAM,
  },

  presets: CONTRAST_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
