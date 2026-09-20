// Hue Shift Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { HUE_SHIFT_PARAMS } from '../remainingColorParams';

export const hueShift: EffectDefinition = {
  id: 'hue-shift',
  name: 'Hue Shift',
  category: 'color',

  shader,
  entryPoint: 'hueShiftFragment',
  uniformSize: 16,

  params: HUE_SHIFT_PARAMS,

  packUniforms: (params) => {
    return new Float32Array([
      params.shift as number ?? 0,
      0, 0, 0, // padding
    ]);
  },
};
