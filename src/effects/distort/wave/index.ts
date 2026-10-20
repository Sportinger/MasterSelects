// Wave: sine ripples across and down the picture, optionally travelling over time.
// The editable graph is the runtime; shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { EDGES_PARAM, UV_DISTORT_COMMON_WGSL, distortNumber, edgeIndex } from '../uvDistortParams';

export const wave: EffectDefinition = {
  id: 'wave',
  name: 'Wave',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'waveFragment',
  uniformSize: 32,

  params: {
    amplitudeX: {
      type: 'number',
      label: 'Horizontal Height',
      default: 0.015,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
    },
    frequencyX: {
      type: 'number',
      label: 'Horizontal Waves',
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      animatable: true,
    },
    amplitudeY: {
      type: 'number',
      label: 'Vertical Height',
      default: 0.015,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
    },
    frequencyY: {
      type: 'number',
      label: 'Vertical Waves',
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      animatable: true,
    },
    edges: EDGES_PARAM,
    speed: {
      type: 'number',
      label: 'Speed',
      default: 0.5,
      min: -4,
      max: 4,
      step: 0.01,
      animatable: true,
      group: 'motion',
    },
    phase: {
      type: 'number',
      label: 'Phase',
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      animatable: true,
      group: 'motion',
    },
  },

  packUniforms: (params, width, height, time = 0) => new Float32Array([
    distortNumber(params.amplitudeX, 0.015),
    distortNumber(params.amplitudeY, 0.015),
    distortNumber(params.frequencyX, 4),
    distortNumber(params.frequencyY, 4),
    distortNumber(params.phase, 0) * Math.PI / 180 + Math.PI * 2 * distortNumber(params.speed, 0.5) * time,
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
  ]),
};
