// Brightness Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { BRIGHTNESS_AMOUNT_PARAM } from '../sharedColorAmountParams';

export const brightness: EffectDefinition = {
  id: 'brightness',
  name: 'Brightness',
  category: 'color',

  shader,
  entryPoint: 'brightnessFragment',
  uniformSize: 16,

  params: {
    amount: BRIGHTNESS_AMOUNT_PARAM,
  },

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0,
      0, 0, 0, // padding
    ]);
  },
};
