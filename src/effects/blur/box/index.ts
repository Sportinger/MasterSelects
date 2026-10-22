// Box Blur: separable box with a fractional edge tap, premultiplied, radius relative to a
// 1080p frame. Rendering is owned by the editable operator graph
// (services/operators/blurEffectGraphs.ts); separableBlur.wgsl is its WGSL reference.

import shader from '../separableBlur.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { finiteBlurParam } from '../blurSampling';

export const BOX_BLUR_PRESETS: readonly EffectPreset[] = [
  // Just takes the digital edge off sharp footage or graphics.
  { id: 'soft-edge', name: 'Soft Edge', params: { radius: 1.5 } },
  // A frosted panel: shapes stay readable as areas, detail and text behind it are gone.
  { id: 'frosted-glass', name: 'Frosted Glass', params: { radius: 8 } },
  // Small lights turn into flat squares, the graphic look Gaussian Blur does not give.
  { id: 'square-lights', name: 'Square Lights', params: { radius: 20 } },
  // Only large colour areas are left: a backdrop of light and colour.
  { id: 'colour-field', name: 'Colour Field', params: { radius: 50 } },
];

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
      unit: ' px',
      animatable: true,
    },
  },

  presets: BOX_BLUR_PRESETS,

  packUniforms: (params, width, height) => new Float32Array([finiteBlurParam(params.radius, 5), width, height, 1]),
};
