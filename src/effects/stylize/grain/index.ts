// Film Grain Effect - smooth two-octave grain on a 1080p-relative cell grid, a new pattern per
// frame, film-like midtone response and optional color grain.
// Rendering is owned by the editable operator graph (services/operators/grainEffectGraph.ts);
// its contract is grainModel.ts. Grains saved before 2026-10-21 keep their earlier sine-hash
// graph (contextualEffectGraphs.ts); shader.wgsl is the WGSL reference of that earlier grain
// and only prewarms the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { grainParamNotes } from './grainModel';

export const grain: EffectDefinition = {
  id: 'grain',
  name: 'Film Grain',
  category: 'stylize',

  shader,
  entryPoint: 'grainFragment',
  uniformSize: 32,
  // The earlier grain of saved projects: a note and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 0.1,
      min: 0,
      max: 0.5,
      step: 0.01,
      animatable: true,
    },
    size: {
      type: 'number',
      label: 'Size',
      default: 1,
      min: 0.5,
      max: 5,
      step: 0.1,
      animatable: true,
    },
    speed: {
      type: 'number',
      label: 'Speed',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      animatable: false,
    },
    chroma: {
      type: 'number',
      label: 'Color',
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
      animatable: true,
      graphOnly: true,
    },
    seed: {
      type: 'number',
      label: 'Seed',
      default: 0,
      min: 0,
      max: 65535,
      step: 1,
      animatable: false,
    },
  },

  paramWarnings: (params) => grainParamNotes(params),

  packUniforms: (params, _width, _height, timelineTimeSeconds = 0) => {
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    return new Float32Array([
      params.amount as number ?? 0.1,
      params.size as number ?? 1,
      params.speed as number ?? 1,
      time,
      params.seed as number ?? 0,
      0, 0, 0,
    ]);
  },
};
