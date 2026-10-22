// Motion Blur: two-stage directional blur along an on-screen angle; Length reaches a share of the frame size to each side.
// Rendering is owned by the editable operator graph (services/operators/directionalBlurEffectGraphs.ts);
// directionalBlur.wgsl is its WGSL reference. Contract: ../blurSampling.ts.

import shader from '../directionalBlur.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { finiteBlurParam } from '../blurSampling';

// Angle is stored in radians; presets name it in degrees.
const DEG = Math.PI / 180;

export const MOTION_BLUR_PRESETS: readonly EffectPreset[] = [
  // A small sideways move: speed without losing the face.
  { id: 'quick-move', name: 'Quick Move', params: { amount: 0.015, angle: 0 } },
  // A jump caught rising to one side.
  { id: 'leap', name: 'Leap', params: { amount: 0.035, angle: 340 * DEG } },
  // Streaks straight down: falling, rain, a drop from the flies.
  { id: 'falling', name: 'Falling', params: { amount: 0.04, angle: 90 * DEG } },
  // The camera tears sideways: only colour and light are left, a cut between two shots.
  { id: 'whip-pan', name: 'Whip Pan', params: { amount: 0.15, angle: 0 } },
];

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
      // Stored as a share of the frame (tools, keyframes); the card shows percent.
      displayScale: 100,
      unit: '%',
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
      // Stored in radians (tools, keyframes); the card shows degrees.
      displayUnit: 'degrees',
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

  presets: MOTION_BLUR_PRESETS,

  packUniforms: (params, width, height) => new Float32Array([
    finiteBlurParam(params.amount, 0.05), finiteBlurParam(params.angle, 0), 0.5, 0.5, width, height, 0, 0,
  ]),
};
