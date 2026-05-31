// Crossfade Transition - linear opacity dissolve between two clips.

import type { TransitionDefinition } from '../types';
import { EASING_PARAM } from '../types';
import shader from './shader.wgsl?raw';

export const crossfade: TransitionDefinition = {
  id: 'crossfade',
  name: 'Crossfade',
  category: 'dissolve',
  defaultDuration: 0.5,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Smooth dissolve between clips',
  shader,
  entryPoint: 'crossfadeFragment',
  uniformSize: 32,
  params: {
    easing: EASING_PARAM,
  },
  packUniforms: (_params, progress) =>
    new Float32Array([progress, 0, 0, 0, 0, 0, 0, 0]),
};
