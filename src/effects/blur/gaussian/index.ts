// Gaussian Blur: separable, premultiplied, radius relative to a 1080p frame.
// Rendering is owned by the editable operator graph (services/operators/blurEffectGraphs.ts);
// separableBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../separableBlur.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { GAUSSIAN_BLUR_PARAMS } from './params';
import { finiteBlurParam } from '../blurSampling';

export const gaussianBlur: EffectDefinition = {
  id: 'gaussian-blur',
  name: 'Gaussian Blur',
  category: 'blur',

  shader,
  entryPoint: 'gaussianBlurFragment',
  uniformSize: 16,

  params: GAUSSIAN_BLUR_PARAMS,

  packUniforms: (params, width, height) => new Float32Array([finiteBlurParam(params.radius, 10), width, height, 0]),
};
