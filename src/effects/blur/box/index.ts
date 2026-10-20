// Box Blur: separable box with a fractional edge tap, premultiplied, radius relative to a
// 1080p frame. Rendering is owned by the editable operator graph
// (services/operators/blurEffectGraphs.ts); separableBlur.wgsl is its WGSL reference.

import shader from '../separableBlur.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { finiteBlurParam } from '../blurSampling';

export const boxBlur: EffectDefinition = {
  id: 'box-blur',
  name: 'Box Blur',
  category: 'blur',

  shader,
  entryPoint: 'boxBlurFragment',
  uniformSize: 16,

  params: {
    radius: {
      type: 'number',
      label: 'Radius',
      default: 5,
      min: 0,
      max: 50,
      step: 0.1,
      animatable: true,
    },
  },

  packUniforms: (params, width, height) => new Float32Array([finiteBlurParam(params.radius, 5), width, height, 1]),
};
