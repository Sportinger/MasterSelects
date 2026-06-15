// Random Blocks Transition
// Reveals the incoming clip through deterministic large block ordering.

import type { TransitionDefinition } from '../types';

export const randomBlocks: TransitionDefinition = {
  id: 'random-blocks',
  name: 'Random Blocks',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through large seeded block tiles',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'random-blocks',
    },
  ],
};
