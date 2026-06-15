// Venetian Blinds Vertical Transition
// Reveals the incoming clip in staggered vertical strips.

import type { TransitionDefinition } from '../types';

export const venetianBlindsVertical: TransitionDefinition = {
  id: 'venetian-blinds-vertical',
  name: 'Venetian Blinds Vertical',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through staggered vertical blinds',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'venetian-vertical',
    },
  ],
};
