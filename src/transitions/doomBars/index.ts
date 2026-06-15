// Doom Bars Transition
// Reveals the incoming clip through staggered vertical bars.

import type { TransitionDefinition } from '../types';

export const doomBars: TransitionDefinition = {
  id: 'doom-bars',
  name: 'Doom Bars',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through staggered vertical bars',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'doom-bars',
    },
  ],
};
