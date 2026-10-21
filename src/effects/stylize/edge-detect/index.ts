// Edge Detect - derivative-of-Gaussian outlines with a resolution-independent line Width.
// Rendering is owned by the editable operator graph (services/operators/edgeDetectEffectGraph.ts);
// its contract is edgeDetectModel.ts. Saved projects keep the earlier Sobel graph; shader.wgsl is
// the WGSL reference of that Sobel and only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { edgeDetectParamNotes } from './edgeDetectModel';

export const edgeDetect: EffectDefinition = {
  id: 'edge-detect',
  name: 'Edge Detect',
  category: 'stylize',

  shader,
  entryPoint: 'edgeDetectFragment',
  uniformSize: 16,
  // The earlier Sobel of saved projects: a note and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: {
    strength: {
      type: 'number',
      label: 'Strength',
      default: 1,
      min: 0,
      max: 5,
      step: 0.1,
      animatable: true,
    },
    width: {
      type: 'number',
      label: 'Width',
      default: 1,
      min: 0.5,
      max: 6,
      step: 0.1,
      animatable: true,
      graphOnly: true,
    },
    colorize: {
      type: 'number',
      label: 'Color',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
      graphOnly: true,
    },
    invert: {
      type: 'boolean',
      label: 'Invert',
      default: false,
    },
  },

  paramWarnings: (params, width, height) => edgeDetectParamNotes(params, width, height),

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.strength as number ?? 1,
      width,
      height,
      params.invert ? 1 : 0,
    ]);
  },
};
