// CRT Scanlines Effect - a sine line pattern over the frame height that fades into an even
// darkening where the lines get too dense to show. Rendering is owned by the editable operator
// graph (services/operators/scanlinesEffectGraph.ts); its contract is scanlinesModel.ts.
// Scanlines saved before 2026-10-21 keep their earlier graph; shader.wgsl only prewarms.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { scanlinesParamNotes } from './scanlinesModel';

export const scanlines: EffectDefinition = {
  id: 'scanlines',
  name: 'Scanlines',
  category: 'stylize',

  shader,
  entryPoint: 'scanlinesFragment',
  uniformSize: 16,
  // The earlier recipe of saved projects: a note and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: {
    density: {
      type: 'number',
      label: 'Density',
      default: 5,
      min: 1,
      max: 20,
      step: 0.5,
      animatable: true,
    },
    opacity: {
      type: 'number',
      label: 'Opacity',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    speed: {
      type: 'number',
      label: 'Scroll Speed',
      default: 0,
      min: 0,
      max: 5,
      step: 0.1,
      animatable: false,
    },
  },

  paramWarnings: (params, width, height) => scanlinesParamNotes(params, width, height),

  packUniforms: (params, _width, _height, timelineTimeSeconds = 0) => {
    const time = Number.isFinite(timelineTimeSeconds) ? timelineTimeSeconds : 0;
    return new Float32Array([
      params.density as number ?? 5,
      params.opacity as number ?? 0.3,
      params.speed as number ?? 0,
      time,
    ]);
  },
};
