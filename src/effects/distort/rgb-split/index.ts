// RGB Split: offsets the red and blue channels against green, like misregistered print plates or
// (Lens mode) the colour fringes of a lens. The editable graph is the runtime
// (services/operators/mirrorRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
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
