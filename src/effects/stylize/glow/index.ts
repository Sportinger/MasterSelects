// Glow Effect - a lens bloom: a bright pass that ramps up to white, a half-size pyramid and a tent upsample.
// Rendering is owned by the editable operator graph (services/operators/glowBloomEffectGraph.ts);
// its contract is glowBloom.ts. Glows saved before the bloom keep their ring graph
// (services/operators/glowEffectGraph.ts, contract glowSampling.ts); shader.wgsl is the WGSL
// reference of that ring recipe and is only used to prewarm the generic effect layout.

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { GLOW_DEFAULTS, glowParamNotes } from './glowBloom';

export const GLOW_PRESETS: readonly EffectPreset[] = [
  // A small, crisp halo around the lamps and neon only; the rest of the picture stays sharp.
  { id: 'tight-halo', name: 'Tight Halo', params: { amount: 3, threshold: 0.9, radius: 18 } },
  // Neon and practical lights bloom strongly, as through a lens in a rainy night.
  { id: 'neon-bloom', name: 'Neon Bloom', params: { amount: 4, threshold: 0.85, softness: 0.6, radius: 70 } },
  // Bright skin and costumes join in too: a soft, wide, dreamy haze over the whole scene.
  { id: 'dream-glow', name: 'Dream Glow', params: { amount: 1.6, threshold: 0.55, softness: 1, radius: 160 } },
  // A cool blue halo, like moonlight or a cold follow spot, on warm footage too.
  { id: 'moonlight', name: 'Moonlight', params: { amount: 2.5, threshold: 0.7, softness: 0.8, radius: 120, color: '#9cc4ff' } },
];

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
      default: GLOW_DEFAULTS.amount,
      min: 0,
      max: 5,
      step: 0.05,
      animatable: true,
    },
    threshold: {
      type: 'number',
      label: 'Threshold',
      default: GLOW_DEFAULTS.threshold,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    softness: {
      type: 'number',
      label: 'Softness',
      default: GLOW_DEFAULTS.softness,
      min: 0,
      max: 1,
      step: 0.01,
      animatable: true,
    },
    radius: {
      type: 'number',
      label: 'Radius',
      default: GLOW_DEFAULTS.radius,
      min: 0,
      max: 300,
      step: 1,
      unit: ' px',
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

  presets: GLOW_PRESETS,

  paramWarnings: (params, width, height) => glowParamNotes(params, width, height),

  packUniforms: (params, width, height) => {
    return new Float32Array([
      params.amount as number ?? GLOW_DEFAULTS.amount,
      params.threshold as number ?? GLOW_DEFAULTS.threshold,
      params.radius as number ?? GLOW_DEFAULTS.radius,
      params.softness as number ?? GLOW_DEFAULTS.softness,
      width,
      height,
      params.rings as number ?? 6.85,
      params.samplesPerRing as number ?? 17.95,
    ]);
  },
};
