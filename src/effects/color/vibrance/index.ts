// Vibrance Effect

import shader from './shader.wgsl?raw';
import type { EffectDefinition, EffectPreset } from '../../types';
import { VIBRANCE_PARAMS } from '../remainingColorParams';

/** Three clearly different starting points; pale colours move most, lit skin tones least. */
export const VIBRANCE_PRESETS: readonly EffectPreset[] = [
  // A clear push: pale colours fill up, strong ones and skin move little.
  { id: 'vibrant', name: 'Vibrant', params: { amount: 1 } },
  // The top of the slider: pale skies, walls and haze bloom while strong colours hold.
  { id: 'strong', name: 'Strong', params: { amount: 2 } },
  // Pale colours fade toward grey, strong colours and skin keep theirs: a quiet, subdued look.
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
