// Zoom Blur: two-stage zoom streaks outward from a centre (log-scale steps).
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { finiteBlurParam } from '../blurSampling';

// Presets keep the centre in the middle of the frame; a streak reaches Amount / 2 of each pixel's distance to it.
export const ZOOM_BLUR_PRESETS: readonly EffectPreset[] = [
  // A slight push towards the middle: the picture stays readable, the edges begin to move.
  { id: 'push-in', name: 'Push In', params: { amount: 0.08 } },
  // A clear jolt into the picture, for a hit on a beat.
  { id: 'impact', name: 'Impact', params: { amount: 0.2 } },
  // Long streaks of light rush out of the middle; only the centre stays recognisable.
  { id: 'rush', name: 'Rush', params: { amount: 0.45 } },
  // Everything but the very middle dissolves into rays.
  { id: 'light-speed', name: 'Light Speed', params: { amount: 0.9 } },
];

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

  presets: ZOOM_BLUR_PRESETS,

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.3), 0, finiteBlurParam(params.centerX, 0.5), finiteBlurParam(params.centerY, 0.5), width, height, 1, 0,
  ]),
};
