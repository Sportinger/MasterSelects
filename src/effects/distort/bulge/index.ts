// Bulge & Pinch: magnifies (Amount above 1) or squeezes (below 1) a round area.
// The editable graph is the runtime; shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { EDGES_PARAM, SHAPE_PARAM, UV_DISTORT_COMMON_WGSL, distortNumber, edgeIndex, radiusWarnings, shapeIndex } from '../uvDistortParams';

export const bulge: EffectDefinition = {
  id: 'bulge',
  name: 'Bulge & Pinch',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'bulgeFragment',
  uniformSize: 32,

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1.6,
      min: 0,
      max: 3,
      step: 0.01,
      animatable: true,
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

  paramWarnings: params => [...radiusWarnings(params), ...(typeof params.amount === 'number' && params.amount < 0
    ? [`amount: ${params.amount} acts like 0, the strongest pinch.`] : [])],
  packUniforms: (params, width, height) => new Float32Array([
    distortNumber(params.amount, 1.6),
    distortNumber(params.radius, 0.5),
    distortNumber(params.centerX, 0.5),
    distortNumber(params.centerY, 0.5),
    shapeIndex(params.shape),
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
  ]),
};
