// Vignette Effect - a resolution- and aspect-independent darkening towards the corners.
// Rendering is owned by the editable operator graph (services/operators/vignetteEffectGraph.ts);
// its contract is vignetteModel.ts. Vignettes saved before 2026-10-21 keep their earlier graph
// (contextualEffectGraphs.ts); shader.wgsl only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { VIGNETTE_PARAMS } from './parameters';
import { vignetteParamNotes } from './vignetteModel';

export const vignette: EffectDefinition = {
  id: 'vignette',
  name: 'Vignette',
  category: 'stylize',

  shader,
  entryPoint: 'vignetteFragment',
  uniformSize: 16,

  // The earlier recipe of saved projects: a note and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: VIGNETTE_PARAMS,

  paramWarnings: (params) => vignetteParamNotes(params),

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0.5,
      params.size as number ?? 0.5,
      params.softness as number ?? 0.5,
      params.roundness as number ?? 1,
    ]);
  },
};
