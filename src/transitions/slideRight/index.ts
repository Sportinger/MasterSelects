// Slide Right Transition
// Moves the incoming clip from left to center over the outgoing clip.

import type { TransitionDefinition } from '../types';

export const slideRight: TransitionDefinition = {
  id: 'slide-right',
  name: 'Slide Right',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Slide the incoming clip in from the left over the outgoing clip',
  recipe: [
    {
      kind: 'transform',
      target: 'incoming',
      translateX: { from: -1, to: 0 },
      curve: 'linear',
    },
  ],
};
