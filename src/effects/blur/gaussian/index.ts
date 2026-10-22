// Gaussian Blur: separable, premultiplied, radius relative to a 1080p frame.
// Rendering is owned by the editable operator graph (services/operators/blurEffectGraphs.ts);
// separableBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../separableBlur.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { GAUSSIAN_BLUR_PARAMS } from './params';
import { finiteBlurParam } from '../blurSampling';

export const GAUSSIAN_BLUR_PRESETS: readonly EffectPreset[] = [
  // Takes the digital edge off without looking blurred.
  { id: 'soften', name: 'Soften', params: { radius: 3 } },
  // Clearly out of focus, shapes still readable: a background behind a title.
  { id: 'out-of-focus', name: 'Out of Focus', params: { radius: 10 } },
  // A deep background: only the large forms and lights are left.
  { id: 'far-background', name: 'Far Background', params: { radius: 22 } },
  // Lights melt into soft round glows of colour.
  { id: 'wash-of-light', name: 'Wash of Light', params: { radius: 50 } },
];

export const gaussianBlur: EffectDefinition = {
  id: 'gaussian-blur',
  name: 'Gaussian Blur',
  category: 'blur',

  shader,
  entryPoint: 'gaussianBlurFragment',
  uniformSize: 16,

  params: GAUSSIAN_BLUR_PARAMS,

  presets: GAUSSIAN_BLUR_PRESETS,

  packUniforms: (params, width, height) => new Float32Array([finiteBlurParam(params.radius, 10), width, height, 0]),
};
