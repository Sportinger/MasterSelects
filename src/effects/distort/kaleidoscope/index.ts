// Kaleidoscope: folds the picture into mirrored wedges around a centre.
// The editable graph is the runtime (services/operators/mirrorRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { EDGES_PARAM, SHAPE_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex, shapeIndex } from '../uvDistortParams';
import { KALEIDOSCOPE_MAX_SEGMENTS, KALEIDOSCOPE_MIN_SEGMENTS, KALEIDOSCOPE_MIN_ZOOM } from '../../../services/operators/mirrorRecipes';

type Params = Record<string, number | boolean | string>;

/** Segment counts and zoom the recipe clamps: say so instead of silently drawing another pattern. */
export function kaleidoscopeWarnings(params: Params): string[] {
  const warnings: string[] = [];
  const segments = params.segments, zoom = params.zoom;
  if (typeof segments === 'number' && (segments < KALEIDOSCOPE_MIN_SEGMENTS || segments > KALEIDOSCOPE_MAX_SEGMENTS)) {
    warnings.push(`segments: ${segments} is outside ${KALEIDOSCOPE_MIN_SEGMENTS}–${KALEIDOSCOPE_MAX_SEGMENTS}; the kaleidoscope uses ${segments < KALEIDOSCOPE_MIN_SEGMENTS ? KALEIDOSCOPE_MIN_SEGMENTS : KALEIDOSCOPE_MAX_SEGMENTS}.`);
  }
  if (typeof zoom === 'number' && zoom < KALEIDOSCOPE_MIN_ZOOM) {
    warnings.push(`zoom: ${zoom} is below ${KALEIDOSCOPE_MIN_ZOOM}; the kaleidoscope uses ${KALEIDOSCOPE_MIN_ZOOM}.`);
  }
  return [...warnings, ...choiceWarnings(params)];
}

export const kaleidoscope: EffectDefinition = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'kaleidoscopeFragment',
  uniformSize: 48,

  params: {
    // Fractional counts crossfade the two neighbouring whole counts (smooth when animated, never a seam).
    segments: {
      type: 'number',
      label: 'Segments',
      default: 6,
      min: 2,
      max: 16,
      step: 1,
      animatable: true,
    },
    // Stored in radians (saved projects, keyframes, tools); the inspector shows degrees. Spins the whole pattern.
    rotation: {
      type: 'number',
      label: 'Rotation',
      default: 0,
      min: -2 * Math.PI,
      max: 2 * Math.PI,
      step: 0.01,
      animatable: true,
      displayUnit: 'degrees',
    },
    // Radians like Rotation (the inspector shows degrees): which slice of the picture the mirrors show (turning the tube).
    sourceAngle: {
      type: 'number',
      label: 'Source Angle',
      default: 0,
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      animatable: true,
      displayUnit: 'degrees',
      graphOnly: true,
    },
    zoom: {
      type: 'number',
      label: 'Zoom',
      default: 1,
      min: 0.25,
      max: 4,
      step: 0.01,
      animatable: true,
      graphOnly: true,
    },
    centerX: {
      type: 'number',
      label: 'Center X',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      graphOnly: true,
    },
    centerY: {
      type: 'number',
      label: 'Center Y',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      graphOnly: true,
    },
    shape: SHAPE_PARAM,
    edges: EDGES_PARAM,
  },

  paramWarnings: kaleidoscopeWarnings,
  packUniforms: (params, width, height) => new Float32Array([
    distortNumber(params.segments, 6),
    distortNumber(params.rotation, 0),
    distortNumber(params.sourceAngle, 0),
    distortNumber(params.zoom, 1),
    distortNumber(params.centerX, 0.5),
    distortNumber(params.centerY, 0.5),
    shapeIndex(params.shape),
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
    0, 0,
  ]),
};
