// Invert Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const invert: EffectDefinition = {
  id: 'invert',
  name: 'Invert',
  category: 'color',

  shader,
  entryPoint: 'invertFragment',
  uniformSize: 0, // No uniforms needed

  params: {
    // No parameters for invert
  },

  packUniforms: () => null,
};
