// Levels Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { LEVELS_PARAMS } from '../remainingColorParams';

export const levels: EffectDefinition = {
  id: 'levels',
  name: 'Levels',
  category: 'color',

  shader,
  entryPoint: 'levelsFragment',
  uniformSize: 32, // 8 floats

  params: LEVELS_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.inputBlack as number ?? 0,
      params.inputWhite as number ?? 1,
      params.gamma as number ?? 1,
      params.outputBlack as number ?? 0,
      params.outputWhite as number ?? 1,
      0, 0, 0, // padding
    ]);
  },
};
