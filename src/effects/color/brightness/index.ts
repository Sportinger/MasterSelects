// Brightness Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { BRIGHTNESS_AMOUNT_PARAM } from '../sharedColorAmountParams';

/** Starting points from a gentle lift to nightfall; black and white stay put in all of them. */
export const BRIGHTNESS_PRESETS: readonly EffectPreset[] = [
  // A dim projection or a slightly dark shot, lifted without a grey veil.
  { id: 'soft-lift', name: 'Soft Lift', params: { amount: 0.3 } },
  // Open, airy mid-tones, as under full stage light; the brightest whites still hold.
  { id: 'full-light', name: 'Full Light', params: { amount: 0.7 } },
  // Calmer, heavier mid-tones: evening light, a background behind a title.
  { id: 'dusk', name: 'Dusk', params: { amount: -0.35 } },
  // Only the lights and the brightest surfaces remain.
  { id: 'nightfall', name: 'Nightfall', params: { amount: -0.8 } },
];

export const brightness: EffectDefinition = {
  id: 'brightness',
  name: 'Brightness',
  category: 'color',

  shader,
  entryPoint: 'brightnessFragment',
  uniformSize: 16,

  params: {
    amount: BRIGHTNESS_AMOUNT_PARAM,
  },

  presets: BRIGHTNESS_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0,
      0, 0, 0, // padding
    ]);
  },
};
