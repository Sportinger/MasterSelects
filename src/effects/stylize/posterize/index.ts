// Posterize Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { POSTERIZE_PARAMS } from '../pointwiseParams';

export const posterize: EffectDefinition = {
  id: 'posterize',
  name: 'Posterize',
  category: 'stylize',

  shader,
  entryPoint: 'posterizeFragment',
  uniformSize: 16,

  params: POSTERIZE_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.levels as number ?? 6,
      0, 0, 0,
    ]);
  },
};
