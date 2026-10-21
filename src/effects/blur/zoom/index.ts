// Zoom Blur: two-stage zoom streaks outward from a centre (log-scale steps).
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { finiteBlurParam } from '../blurSampling';

export const zoomBlur: EffectDefinition = {
  id: 'zoom-blur',
  name: 'Zoom Blur',
  category: 'blur',

  shader,
  entryPoint: 'zoomBlurFragment',
  uniformSize: 32,

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    centerX: {
      type: 'number',
      label: 'Center X',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    centerY: {
      type: 'number',
      label: 'Center Y',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    samples: {
      type: 'number',
      label: 'Samples',
      default: 16,
      min: 4,
      max: 256,
      step: 1,
      animatable: false,
      hidden: true,
      deprecated: 'Zoom Blur now chooses its taps from the streak length automatically; samples has no effect.',
    },
  },

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.3), 0, finiteBlurParam(params.centerX, 0.5), finiteBlurParam(params.centerY, 0.5), width, height, 1, 0,
  ]),
};
