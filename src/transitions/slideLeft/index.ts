// Slide Left Transition
// Moves the incoming clip from right to center over the outgoing clip.

import type { TransitionDefinition } from '../types';

export const slideLeft: TransitionDefinition = {
  id: 'slide-left',
  name: 'Slide Left',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Slide the incoming clip in from the right over the outgoing clip',
  recipe: [
    {
      kind: 'transform',
      target: 'incoming',
      translateX: { from: 1, to: 0 },
      curve: 'linear',
    },
  ],
};
