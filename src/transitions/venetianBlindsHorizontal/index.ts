// Venetian Blinds Horizontal Transition
// Reveals the incoming clip in staggered horizontal strips.

import type { TransitionDefinition } from '../types';

export const venetianBlindsHorizontal: TransitionDefinition = {
  id: 'venetian-blinds-horizontal',
  name: 'Venetian Blinds Horizontal',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through staggered horizontal blinds',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'venetian-horizontal',
    },
  ],
};
