// Threshold Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { THRESHOLD_PARAMS } from '../pointwiseParams';

export const threshold: EffectDefinition = {
  id: 'threshold',
  name: 'Threshold',
  category: 'stylize',

  shader,
  entryPoint: 'thresholdFragment',
  uniformSize: 16,

  params: THRESHOLD_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.level as number ?? 0.5,
      0, 0, 0,
    ]);
  },
};
