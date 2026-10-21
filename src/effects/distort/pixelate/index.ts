// Pixelate: rebuilds the picture from square cells, each showing the average colour of its pixels.
// The editable graph is the runtime (services/operators/cellGridRecipes.ts); shader.wgsl is its WGSL reference.

import shader from './shader.wgsl?raw';
import common from '../../pixel/cellGridCommon.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { pixelSizeWarnings } from '../../pixel/cellGridParams';

export const pixelate: EffectDefinition = {
  id: 'pixelate',
  name: 'Pixelate',
  category: 'distort',

  shader: `${common}\n${shader}`,
  entryPoint: 'pixelateFragment',
  uniformSize: 16,

  params: {
    // Pixels of a 1080p frame (shorter side), rounded to whole rendered pixels; below one
    // rendered pixel (0 at any resolution) the picture passes through unchanged.
    size: {
      type: 'number',
      label: 'Pixel Size',
      default: 12,
      min: 0,
      max: 128,
      step: 1,
      animatable: true,
    },
  },

  paramWarnings: params => pixelSizeWarnings(params.size),
  packUniforms: (params, width, height) => new Float32Array([
    typeof params.size === 'number' && Number.isFinite(params.size) ? params.size : 12,
    Math.max(1, width),
    Math.max(1, height),
    0,
  ]),
};
