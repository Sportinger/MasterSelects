// Radial Blur: two-stage Zoom (legacy inward falloff) or Spin (rotation) about a centre.
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { finiteBlurParam, radialBlurMode } from '../blurSampling';

export const radialBlur: EffectDefinition = {
  id: 'radial-blur',
  name: 'Radial Blur',
  category: 'blur',

  shader,
  entryPoint: 'radialBlurFragment',
  uniformSize: 32,

  params: {
    mode: {
      type: 'select',
      label: 'Type',
      graphOnly: true,
      default: 'zoom',
      options: [
        { value: 'zoom', label: 'Zoom' },
        { value: 'spin', label: 'Spin' },
      ],
    },
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.5,
      min: 0,
      max: 2,
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
      default: 32,
      min: 4,
      max: 256,
      step: 1,
      animatable: false,
      hidden: true,
      deprecated: 'Radial Blur now chooses its taps from the streak length automatically; samples has no effect.',
    },
  },

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.5), 0, finiteBlurParam(params.centerX, 0.5), finiteBlurParam(params.centerY, 0.5), width, height, 2,
    radialBlurMode(params.mode) === 'spin' ? 1 : 0,
  ]),
};
