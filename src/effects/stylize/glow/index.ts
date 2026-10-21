// Glow Effect - a lens bloom: soft-knee bright pass, a half-size pyramid and a tent upsample.
// Rendering is owned by the editable operator graph (services/operators/glowBloomEffectGraph.ts);
// its contract is glowBloom.ts. Glows saved before the bloom keep their ring graph
// (services/operators/glowEffectGraph.ts, contract glowSampling.ts); shader.wgsl is the WGSL
// reference of that ring recipe and is only used to prewarm the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { glowParamNotes } from './glowBloom';

const RING_ONLY = 'Only Glows saved with the earlier ring version read it; the bloom chooses its own sampling, so it has no effect here.';

export const glow: EffectDefinition = {
  id: 'glow',
  name: 'Glow',
  category: 'stylize',

  shader,
  entryPoint: 'glowFragment',
  uniformSize: 32, // 8 floats
  // The earlier ring version of saved Glows: its quality limits and an update offer.
  extraControls: () => import('../StylizeRecipeNote'),

  params: {
    amount: {
      type: 'number',
      label: 'Amount',
      default: 1.5,
      min: 0,
      max: 5,
      step: 0.05,
      animatable: true,
    },
    threshold: {
      type: 'number',
      label: 'Threshold',
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    softness: {
      type: 'number',
      label: 'Softness',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    radius: {
      type: 'number',
      label: 'Radius',
      default: 40,
      min: 0,
      max: 300,
      step: 1,
      animatable: true,
    },
    color: { type: 'color', label: 'Color', default: '#ffffff', graphOnly: true },
    rings: {
      type: 'number',
      label: 'Rings',
      default: 6.85,
      min: 1,
      max: 32,
      step: 1,
      animatable: false,
      hidden: true,
      deprecated: RING_ONLY,
    },
    samplesPerRing: {
      type: 'number',
      label: 'Samples/Ring',
      default: 17.95,
      min: 4,
      max: 64,
      step: 1,
      animatable: false,
      hidden: true,
      deprecated: RING_ONLY,
    },
  },

  paramWarnings: (params, width, height) => glowParamNotes(params, width, height),

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.amount as number ?? 1,
      params.threshold as number ?? 0.6,
      params.radius as number ?? 40,
      params.softness as number ?? 0.5,
      width,
      height,
      params.rings as number ?? 6.85,
      params.samplesPerRing as number ?? 17.95,
    ]);
  },
};
