// Noise Dissolve Transition
// Reveals the incoming clip through a deterministic dither/noise mask.

import type { TransitionDefinition } from '../types';

export const noiseDissolve: TransitionDefinition = {
  id: 'noise-dissolve',
  name: 'Noise Dissolve',
  category: 'stylize',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through deterministic noise grain',
  params: {
    seed: {
      type: 'number',
      label: 'Seed',
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
    },
  },
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'procedural',
      procedural: 'noise',
    },
  ],
};
