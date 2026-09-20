// Vignette Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { VIGNETTE_PARAMS } from './parameters';

export const vignette: EffectDefinition = {
  id: 'vignette',
  name: 'Vignette',
  category: 'stylize',

  shader,
  entryPoint: 'vignetteFragment',
  uniformSize: 16,

  params: VIGNETTE_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0.5,
      params.size as number ?? 0.5,
      params.softness as number ?? 0.5,
      params.roundness as number ?? 1,
    ]);
  },
};
