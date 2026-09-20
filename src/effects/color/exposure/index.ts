// Exposure Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { EXPOSURE_PARAMS } from '../remainingColorParams';

export const exposure: EffectDefinition = {
  id: 'exposure',
  name: 'Exposure',
  category: 'color',

  shader,
  entryPoint: 'exposureFragment',
  uniformSize: 16,

  params: EXPOSURE_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.exposure as number ?? 0,
      params.offset as number ?? 0,
      params.gamma as number ?? 1,
      0,
    ]);
  },
};
