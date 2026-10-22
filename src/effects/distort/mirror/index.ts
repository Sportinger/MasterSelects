// Mirror: reflects one side of the picture onto the other across a line through Center at Angle.
// The editable graph is the runtime (services/operators/mirrorRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { EDGES_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex } from '../uvDistortParams';
import { MIRROR_KEEP_OPTIONS } from '../../../services/operators/mirrorRecipes';

type Params = Record<string, number | boolean | string>;

export function mirrorWarnings(params: Params): string[] {
  const keep = params.keep;
  return [
    ...(keep === undefined || MIRROR_KEEP_OPTIONS.some(option => option.value === keep) ? [] : [`keep: "${String(keep)}" is not an option; using start.`]),
    ...(params.horizontal === false && params.vertical === false ? ['Left / Right (horizontal) and Top / Bottom (vertical) are both off, so the picture is unchanged.'] : []),
    ...choiceWarnings(params, ['edges']),
  ];
}

/**
 * Presets name the look-defining controls: which lines mirror, the kept side and a level line
 * (Angle 0), so a preset also straightens a turned line. Center X / Center Y stay with the shot.
 */
export const MIRROR_PRESETS: readonly EffectPreset[] = [
  // The top half reflected into the bottom, like a landscape in still water.
  { id: 'still-lake', name: 'Still Lake', params: { horizontal: false, vertical: true, keep: 'start', angle: 0 } },
  // The bottom half folded up into the sky: the ground closes over the picture like a bent city.
  { id: 'folded-city', name: 'Folded City', params: { horizontal: false, vertical: true, keep: 'end', angle: 0 } },
  // The right half reflected onto the left: a figure facing its own reflection.
  { id: 'face-to-face', name: 'Face to Face', params: { horizontal: true, vertical: false, keep: 'end', angle: 0 } },
  // Both lines: the top-left quarter four times, an emblem around the centre.
  { id: 'four-way', name: 'Four Way', params: { horizontal: true, vertical: true, keep: 'start', angle: 0 } },
];

export const mirror: EffectDefinition = {
  id: 'mirror',
  name: 'Mirror',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'mirrorFragment',
  uniformSize: 48,

  params: {
    // Mirror across the vertical line (left side onto the right).
    horizontal: {
      type: 'boolean',
      label: 'Left / Right',
      default: true,
    },
    // Mirror across the horizontal line (top onto the bottom).
    vertical: {
      type: 'boolean',
      label: 'Top / Bottom',
      default: false,
    },
    keep: { type: 'select', label: 'Keep', default: 'start', options: MIRROR_KEEP_OPTIONS, graphOnly: true },
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
    // Radians (the inspector shows degrees): turns the mirror lines about the centre.
    angle: {
      type: 'number',
      label: 'Angle',
      default: 0,
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      animatable: true,
      displayUnit: 'degrees',
      graphOnly: true,
    },
    edges: EDGES_PARAM,
  },

  presets: MIRROR_PRESETS,

  paramWarnings: mirrorWarnings,
  packUniforms: (params, width, height) => new Float32Array([
    params.horizontal !== false ? 1 : 0,
    params.vertical === true ? 1 : 0,
    params.keep === 'end' ? 1 : 0,
    distortNumber(params.angle, 0),
    distortNumber(params.centerX, 0.5),
    distortNumber(params.centerY, 0.5),
    edgeIndex(params.edges),
    0,
    Math.max(1, width),
    Math.max(1, height),
    0, 0,
  ]),
};
