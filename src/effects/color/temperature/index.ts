// Color Temperature Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { TEMPERATURE_PARAMS } from '../remainingColorParams';

export const temperature: EffectDefinition = {
  id: 'temperature',
  name: 'Temperature',
  category: 'color',

  shader,
  entryPoint: 'temperatureFragment',
  uniformSize: 16,

  params: TEMPERATURE_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.temperature as number ?? 0,
      params.tint as number ?? 0,
      0, 0,
    ]);
  },
};
