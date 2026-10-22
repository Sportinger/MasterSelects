// Vibrance Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { VIBRANCE_PARAMS } from '../remainingColorParams';

/** Starting points from muted to vibrant; pale colours move most, lit skin tones least. */
export const VIBRANCE_PRESETS: readonly EffectPreset[] = [
  // A small lift for pale footage; skin stays as it was.
  { id: 'gentle', name: 'Gentle', params: { amount: 0.3 } },
  // Livelier colour in the haze, the light and the costume, while faces stay natural.
  { id: 'lively', name: 'Lively', params: { amount: 0.7 } },
  // The full push of the slider: pale colours bloom, strong ones and skin move little.
  { id: 'vibrant', name: 'Vibrant', params: { amount: 1 } },
  // Pale colours fade toward grey, strong colours and skin keep theirs: a quiet, muted look.
  { id: 'muted', name: 'Muted', params: { amount: -0.6 } },
];

export const vibrance: EffectDefinition = {
  id: 'vibrance',
  name: 'Vibrance',
  category: 'color',

  shader,
  entryPoint: 'vibranceFragment',
  uniformSize: 16,

  params: VIBRANCE_PARAMS,

  presets: VIBRANCE_PRESETS,

  packUniforms: (params) => {
    return new Float32Array([
      params.amount as number ?? 0,
      0, 0, 0,
    ]);
  },
};
