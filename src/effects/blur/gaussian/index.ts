// Gaussian Blur Effect - High Quality

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';

export const gaussianBlur: EffectDefinition = {
  id: 'gaussian-blur',
  name: 'Gaussian Blur',
  category: 'blur',

  shader,
  entryPoint: 'gaussianBlurFragment',
  uniformSize: 16,

  params: {
    radius: {
      type: 'number',
      label: 'Radius',
      default: 10,
      min: 0,
      max: 50,
      step: 1,
      animatable: true,
    },
    quality: {
      type: 'select',
      label: 'Quality',
      default: '2',
      options: [
        { value: '1', label: 'Low (Fast)' },
        { value: '2', label: 'Medium' },
        { value: '3', label: 'High (Slow)' },
      ],
    },
  },

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.radius as number || 10,
      width,
      height,
      parseFloat(params.quality as string) || 2,
    ]);
  },
};
