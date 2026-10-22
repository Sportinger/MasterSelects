// Twirl: turns the picture around a centre, strongest in the middle and fading to the radius.
// The editable graph is the runtime; shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { EDGES_PARAM, SHAPE_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex, radiusWarnings, shapeIndex } from '../uvDistortParams';

const degrees = (value: number) => value * Math.PI / 180;

/** Presets name only Twist and Radius, the two controls that make the look. */
export const TWIRL_PRESETS: readonly EffectPreset[] = [
  // A slow sway through a wide area: the picture stays readable, as if seen through moving water.
  { id: 'soft-stir', name: 'Soft Stir', params: { amount: degrees(80), radius: 0.8 } },
  // A tight knot in the middle, the rest of the frame untouched.
  { id: 'knot', name: 'Knot', params: { amount: degrees(540), radius: 0.25 } },
  // One full turn: the middle spirals in, the edge of the area still shows the picture.
  { id: 'whirlpool', name: 'Whirlpool', params: { amount: degrees(360), radius: 0.6 } },
  // One and a half turns across the whole frame: spiral bands of colour. 540°, under the ~570° where
  // single-read sampling starts to shimmer on fine moving detail.
  { id: 'vortex', name: 'Vortex', params: { amount: degrees(540), radius: 1 } },
];

export const twirl: EffectDefinition = {
  id: 'twirl',
  name: 'Twirl',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'twirlFragment',
  uniformSize: 32,

  params: {
    // Stored in radians (saved projects, keyframes, tools); the inspector shows degrees
    // (default 2 rad = 115 degrees, range two full turns either way).
    amount: {
      type: 'number',
      label: 'Twist',
      // 120° for new effects (the old 2 rad read as 114.59°); instances saved without the key keep 2 rad.
      default: 2 * Math.PI / 3,
      legacyDefault: 2,
      min: -4 * Math.PI,
      max: 4 * Math.PI,
      step: 0.01,
      animatable: true,
      displayUnit: 'degrees',
    },
    radius: {
      type: 'number',
      label: 'Radius',
      default: 0.5,
      min: 0.05,
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
    shape: SHAPE_PARAM,
    edges: EDGES_PARAM,
  },

  presets: TWIRL_PRESETS,

  paramWarnings: params => [...radiusWarnings(params), ...choiceWarnings(params)],
  packUniforms: (params, width, height) => new Float32Array([
    distortNumber(params.amount, 2),
    distortNumber(params.radius, 0.5),
    distortNumber(params.centerX, 0.5),
    distortNumber(params.centerY, 0.5),
    shapeIndex(params.shape),
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
  ]),
};
