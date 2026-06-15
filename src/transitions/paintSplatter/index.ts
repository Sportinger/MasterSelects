// Paint Splatter Transition
// Reveals the incoming clip through deterministic hard-edged splat cells.

import type { TransitionDefinition } from '../types';

export const paintSplatter: TransitionDefinition = {
  id: 'paint-splatter',
  name: 'Paint Splatter',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through seeded paint splatter cells',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'paint-splatter',
    },
  ],
};
