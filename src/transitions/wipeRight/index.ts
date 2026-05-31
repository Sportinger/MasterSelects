// Wipe Right Transition - a soft edge sweeps from left to right.

import type { TransitionDefinition } from '../types';
import { EASING_PARAM } from '../types';
import shader from '../_shared/wipe.wgsl?raw';

const SOFTNESS_PARAM = {
  type: 'number' as const,
  label: 'Softness',
  default: 0.03,
  min: 0,
  max: 0.5,
  step: 0.01,
};

export const wipeRight: TransitionDefinition = {
  id: 'wipe-right',
  name: 'Wipe Right',
  category: 'wipe',
  defaultDuration: 0.5,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'A soft edge sweeps from left to right',
  shader,
  entryPoint: 'wipeFragment',
  uniformSize: 32,
  params: {
    softness: SOFTNESS_PARAM,
    easing: EASING_PARAM,
  },
  // direction = (1, 0): edge travels toward the right
  packUniforms: (params, progress) =>
    new Float32Array([progress, Number(params.softness ?? 0.03), 1, 0, 0, 0, 0, 0]),
};
