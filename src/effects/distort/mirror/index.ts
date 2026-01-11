// Mirror Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const mirror: EffectDefinition = {
  id: 'mirror',
  name: 'Mirror',
  category: 'distort',

  shader,
  entryPoint: 'mirrorFragment',
  uniformSize: 16,

  params: {
    horizontal: {
      type: 'boolean',
      label: 'Horizontal',
      default: true,
    },
    vertical: {
      type: 'boolean',
      label: 'Vertical',
      default: false,
    },
  },

  packUniforms: (params) => {
    return new Float32Array([
      params.horizontal ? 1 : 0,
      params.vertical ? 1 : 0,
      0, 0, // padding
    ]);
  },
};
