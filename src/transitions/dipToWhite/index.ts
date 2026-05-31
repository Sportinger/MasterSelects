// Dip to White Transition - fade through a solid color (default white).

import type { TransitionDefinition } from '../types';
import { EASING_PARAM } from '../types';
import { hexToRgb } from '../easing';
import shader from '../_shared/dip.wgsl?raw';

export const dipToWhite: TransitionDefinition = {
  id: 'dip-to-white',
  name: 'Dip to White',
  category: 'dissolve',
  defaultDuration: 0.5,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Fade through a solid color, then into the next clip',
  shader,
  entryPoint: 'dipFragment',
  uniformSize: 32,
  params: {
    color: { type: 'color', label: 'Dip Color', default: '#ffffff' },
    easing: EASING_PARAM,
  },
  packUniforms: (params, progress) => {
    const [r, g, b] = hexToRgb(params.color as string);
    return new Float32Array([progress, r, g, b, 0, 0, 0, 0]);
  },
};
