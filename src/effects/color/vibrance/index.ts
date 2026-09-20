// Vibrance Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { VIBRANCE_PARAMS } from '../remainingColorParams';

export const vibrance: EffectDefinition = {
  id: 'vibrance',
  name: 'Vibrance',
  category: 'color',

  shader,
  entryPoint: 'vibranceFragment',
  uniformSize: 16,

  params: VIBRANCE_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0,
      0, 0, 0,
    ]);
  },
};
