// Gaussian Blur Effect - High Quality

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { GAUSSIAN_BLUR_PARAMS } from './params';

export const gaussianBlur: EffectDefinition = {
  id: 'gaussian-blur',
  name: 'Gaussian Blur',
  category: 'blur',

  shader,
  entryPoint: 'gaussianBlurFragment',
  uniformSize: 16,

  params: GAUSSIAN_BLUR_PARAMS,

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.radius as number ?? 10,
      width,
      height,
      params.samples as number ?? 5,
    ]);
  },
};
