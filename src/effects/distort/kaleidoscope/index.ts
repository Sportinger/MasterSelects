// Kaleidoscope: folds the picture into mirrored wedges around a centre.
// The editable graph is the runtime (services/operators/mirrorRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
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

const degrees = (value: number) => value * Math.PI / 180;

/**
 * Presets name Segments, Zoom and Source Angle. Source Angle centres the read slice straight below the
 * centre (90° − 90° / Segments), where a figure standing in the middle of the frame is.
 */
export const KALEIDOSCOPE_PRESETS: readonly EffectPreset[] = [
  // Two mirror pairs, slightly enlarged: a symmetric blot like a folded ink print.
  { id: 'ink-blot', name: 'Ink Blot', params: { segments: 2, zoom: 1.2, sourceAngle: degrees(45) } },
  // Three pairs, close up: big crystal facets, as in a toy kaleidoscope with three mirrors.
  { id: 'crystal', name: 'Crystal', params: { segments: 3, zoom: 1.5, sourceAngle: degrees(60) } },
  // Twelve pairs at full size: a dense, round mandala of thin petals.
  { id: 'mandala', name: 'Mandala', params: { segments: 12, zoom: 1, sourceAngle: degrees(82.5) } },
  // Four pairs, zoomed out: the picture repeats in a mirrored grid of tiles.
  { id: 'tiles', name: 'Tiles', params: { segments: 4, zoom: 0.6, sourceAngle: degrees(67.5) } },
];

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
      wraps: true,
      displayUnit: 'degrees',
    },
    // Radians like Rotation (the inspector shows degrees): which slice of the picture the mirrors show (turning the tube).
    sourceAngle: {
      type: 'number',
      label: 'Source Angle',
      // 75°: the slice straight below the centre at six pairs, where a figure in the middle of the
      // frame stands (0° read the dark side of most shots). Instances saved before keep 0°.
      default: 5 * Math.PI / 12,
      legacyDefault: 0,
      wraps: true,
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

  presets: KALEIDOSCOPE_PRESETS,

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
