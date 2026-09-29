// Weave: procedural strands built from general curve and math nodes. The graph lives on
// `effect.operatorGraph` (domain `geometry`); the 2D stack skips it (see layerEffectStack).

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const weave: EffectDefinition = {
  id: 'weave',
  name: 'Weave',
  category: 'generate',
  shader,
  entryPoint: 'weaveFragment',
  uniformSize: 0,
  params: {},
  packUniforms: () => null,
};
