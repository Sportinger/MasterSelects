// Twirl: turns the picture around a centre, strongest in the middle and fading to the radius.
// The editable graph is the runtime; shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { EDGES_PARAM, SHAPE_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex, radiusWarnings, shapeIndex } from '../uvDistortParams';

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
      default: 2,
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
