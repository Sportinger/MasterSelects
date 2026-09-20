// Saturation Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { SATURATION_AMOUNT_PARAM } from '../sharedColorAmountParams';

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

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
