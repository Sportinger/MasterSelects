// Contrast Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { CONTRAST_AMOUNT_PARAM } from '../sharedColorAmountParams';

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

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
