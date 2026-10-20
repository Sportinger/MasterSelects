// Motion Blur: two-stage directional blur along an on-screen angle; length is a share of the frame width.
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { finiteBlurParam } from '../blurSampling';

export const motionBlur: EffectDefinition = {
  id: 'motion-blur',
  name: 'Motion Blur',
  category: 'blur',

  shader,
  entryPoint: 'motionBlurFragment',
  uniformSize: 32,

  params: {
    amount: {
      type: 'number',
      label: 'Length',
      default: 0.05,
      min: 0,
      max: 0.3,
      step: 0.005,
      animatable: true,
    },
    angle: {
      type: 'number',
      label: 'Angle',
      default: 0,
      min: 0,
      max: 6.28318,
      step: 0.01,
      animatable: true,
    },
    samples: {
      type: 'number',
      label: 'Samples',
      default: 24,
      min: 4,
      max: 128,
      step: 1,
      animatable: false,
      hidden: true,
      deprecated: 'Motion Blur now chooses its taps from the streak length automatically; samples has no effect.',
    },
  },

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.05), finiteBlurParam(params.angle, 0), 0.5, 0.5, width, height, 0, 0,
  ]),
};
