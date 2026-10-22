// Vignette Effect - a resolution- and aspect-independent darkening towards the corners.
// Rendering is owned by the editable operator graph (services/operators/vignetteEffectGraph.ts);
// its contract is vignetteModel.ts. Vignettes saved before 2026-10-21 keep their earlier graph
// (contextualEffectGraphs.ts); shader.wgsl only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { VIGNETTE_PARAMS } from './parameters';
import { vignetteParamNotes } from './vignetteModel';

export const VIGNETTE_PRESETS: readonly EffectPreset[] = [
  // Barely noticeable: the corners settle a little, which calms busy edges without looking like an effect.
  { id: 'soft-frame', name: 'Soft Frame', params: { amount: 0.35, size: 0.3, softness: 1, roundness: 0.6 } },
  // Dark corners that follow the frame, like an old or wide-open lens.
  { id: 'old-lens', name: 'Old Lens', params: { amount: 0.8, size: 0.35, softness: 0.65, roundness: 0 } },
  // A round pool of light in the middle and darkness around it, like a follow spot on a stage.
  { id: 'spotlight', name: 'Spotlight', params: { amount: 0.95, size: 0.12, softness: 0.5, roundness: 1 } },
  // A hard black circle, the iris shot of silent film; keyframe Size to open or close it.
  { id: 'iris', name: 'Iris', params: { amount: 1, size: 0.45, softness: 0.04, roundness: 1 } },
];

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
  presets: VIGNETTE_PRESETS,

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
