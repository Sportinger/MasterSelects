// Radial Blur: two-stage Zoom (legacy inward falloff) or Spin (rotation) about a centre.
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { finiteBlurParam, radialBlurMode } from '../blurSampling';

// Presets leave the centre at the middle of the frame; Spin turns by 20 degrees per unit of Amount.
export const RADIAL_BLUR_PRESETS: readonly EffectPreset[] = [
  // The frame wobbles a few degrees: a dizzy moment, the middle stays readable.
  { id: 'dizzy', name: 'Dizzy', params: { mode: 'spin', amount: 0.2 } },
  // A rotating camera: the figure smears in an arc but is still recognisable.
  { id: 'turning-stage', name: 'Turning Stage', params: { mode: 'spin', amount: 0.6 } },
  // Everything but the middle turns into rings of light.
  { id: 'whirlpool', name: 'Whirlpool', params: { mode: 'spin', amount: 1.5 } },
  // The edges of the frame rush towards the middle, which stays sharp.
  { id: 'tunnel-vision', name: 'Tunnel Vision', params: { mode: 'zoom', amount: 2 } },
];

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

  presets: RADIAL_BLUR_PRESETS,

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.5), 0, finiteBlurParam(params.centerX, 0.5), finiteBlurParam(params.centerY, 0.5), width, height, 2,
    radialBlurMode(params.mode) === 'spin' ? 1 : 0,
  ]),
};
