// Block Glitch Transition
// Reveals the incoming clip through deterministic random blocks.

import type { TransitionDefinition } from '../types';

export const blockGlitch: TransitionDefinition = {
  id: 'block-glitch',
  name: 'Block Glitch',
  category: 'glitch',
  defaultDuration: 0.9,
  minDuration: 0.1,
  maxDuration: 4,
  description: 'Reveal the incoming clip through deterministic glitch blocks',
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
      procedural: 'blocks',
    },
  ],
};
