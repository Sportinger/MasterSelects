// Polka Dot Curtain Transition
// Reveals the incoming clip through expanding deterministic dot cells.

import type { TransitionDefinition } from '../types';

export const polkaDotCurtain: TransitionDefinition = {
  id: 'polka-dot-curtain',
  name: 'Polka Dot Curtain',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through expanding dot cells',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'polka-dot',
    },
  ],
};
