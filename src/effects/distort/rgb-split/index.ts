// RGB Split: offsets the red and blue channels against green, like misregistered print plates or
// (Lens mode) the colour fringes of a lens. The editable graph is the runtime
// (services/operators/mirrorRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { EDGES_PARAM, UV_DISTORT_COMMON_WGSL, choiceWarnings, distortNumber, edgeIndex } from '../uvDistortParams';
import { RGB_SPLIT_LENS_SCALE, RGB_SPLIT_MODE_OPTIONS } from '../../../services/operators/mirrorRecipes';

type Params = Record<string, number | boolean | string>;

export function rgbSplitWarnings(params: Params): string[] {
  const mode = params.mode;
  return [
    ...(mode === undefined || RGB_SPLIT_MODE_OPTIONS.some(option => option.value === mode) ? [] : [`mode: "${String(mode)}" is not an option; using offset.`]),
    ...choiceWarnings(params, ['edges']),
  ];
}

/**
 * Presets name the look-defining controls: Amount, Angle and Mode. Frame Edges stays with the shot.
 * Angle is stored in radians, like the parameter.
 */
export const RGB_SPLIT_PRESETS: readonly EffectPreset[] = [
  // A slight diagonal misregistration, like a poster printed with shifted plates.
  { id: 'misprint', name: 'Misprint', params: { amount: 0.004, angle: Math.PI / 6, mode: 'offset' } },
  // A clear sideways split for a glitch hit.
  { id: 'glitch', name: 'Glitch', params: { amount: 0.02, angle: 0, mode: 'offset' } },
  // Clean in the middle, colour fringes towards the edges, like a cheap lens.
  { id: 'cheap-lens', name: 'Cheap Lens', params: { amount: 0.012, angle: 0, mode: 'lens' } },
  // Red and blue far apart: three ghosts of the picture, as in a dizzy spell.
  { id: 'double-vision', name: 'Double Vision', params: { amount: 0.05, angle: 0, mode: 'offset' } },
];

export const rgbSplit: EffectDefinition = {
  id: 'rgb-split',
  name: 'RGB Split',
  category: 'distort',

  shader: `${UV_DISTORT_COMMON_WGSL}\n${shader}`,
  entryPoint: 'rgbSplitFragment',
  uniformSize: 32,

  params: {
    // Share of the picture width (of the height for vertical splits) red and blue move each way;
    // negative values swap their sides. Lens: the split at the left and right edges.
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.005,
      min: 0,
      max: 0.1,
      step: 0.001,
      animatable: true,
    },
    // Stored in radians (saved projects, keyframes, tools); the inspector shows degrees. Offset mode only.
    angle: {
      type: 'number',
      label: 'Angle',
      default: 0,
      min: 0,
      max: 2 * Math.PI,
      step: 0.01,
      animatable: true,
      displayUnit: 'degrees',
      activeWhen: { param: 'mode', values: ['offset'], note: 'Offset mode only: Lens splits outwards from the centre.' },
    },
    mode: { type: 'select', label: 'Mode', default: 'offset', options: RGB_SPLIT_MODE_OPTIONS, graphOnly: true },
    edges: EDGES_PARAM,
  },

  presets: RGB_SPLIT_PRESETS,

  paramWarnings: rgbSplitWarnings,
  packUniforms: (params, width, height) => new Float32Array([
    distortNumber(params.amount, 0.005),
    distortNumber(params.angle, 0),
    params.mode === 'lens' ? 1 : 0,
    edgeIndex(params.edges),
    Math.max(1, width),
    Math.max(1, height),
    RGB_SPLIT_LENS_SCALE,
    0,
  ]),
};
