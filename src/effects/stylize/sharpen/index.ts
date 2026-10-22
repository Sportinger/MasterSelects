// Sharpen Effect - a brightness unsharp mask with a halo limit.
// Rendering is owned by the editable operator graph (services/operators/sharpenEffectGraph.ts);
// its contract is sharpenModel.ts. Sharpens saved before 2026-10-21 keep their earlier graph
// (blurEffectGraphs.ts); shader.wgsl only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { sharpenParamNotes } from './sharpenModel';

export const SHARPEN_PRESETS: readonly EffectPreset[] = [
  // Hair, fabric and fine texture a touch crisper, without looking processed.
  { id: 'fine-detail', name: 'Fine Detail', params: { amount: 1, radius: 0.7 } },
  // Slightly soft camera footage made clearly crisp.
  { id: 'crisp', name: 'Crisp', params: { amount: 2, radius: 1 } },
  // Every grain and texture pulled out: a rough, high-contrast look.
  { id: 'gritty', name: 'Gritty', params: { amount: 5, radius: 1.5 } },
  // Larger shapes stand out against each other: more depth and local contrast.
  { id: 'punch', name: 'Punch', params: { amount: 1.5, radius: 4 } },
];

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
      unit: ' px',
      animatable: true,
    },
  },

  presets: SHARPEN_PRESETS,

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
