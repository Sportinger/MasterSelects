// Sharpen Effect - a brightness unsharp mask with a halo limit.
// Rendering is owned by the editable operator graph (services/operators/sharpenEffectGraph.ts);
// its contract is sharpenModel.ts. Sharpens saved before 2026-10-21 keep their earlier graph
// (blurEffectGraphs.ts); shader.wgsl only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { sharpenParamNotes } from './sharpenModel';

export const sharpen: EffectDefinition = {
  id: 'sharpen',
  name: 'Sharpen',
  category: 'stylize',

  shader,
  entryPoint: 'sharpenFragment',
  uniformSize: 16,
  // The earlier recipe of saved projects: a note and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1,
      min: 0,
      max: 5,
      step: 0.1,
      animatable: true,
    },
    radius: {
      type: 'number',
      label: 'Radius',
      default: 1,
      min: 0.5,
      max: 5,
      step: 0.1,
      animatable: true,
    },
  },

  paramWarnings: (params, width, height) => sharpenParamNotes(params, width, height),

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.amount as number ?? 1,
      params.radius as number ?? 1,
      width,
      height,
    ]);
  },
};
