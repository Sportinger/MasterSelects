// Slide Up Transition
// Moves the incoming clip from below to center over the outgoing clip.

import type { TransitionDefinition } from '../types';

export const slideUp: TransitionDefinition = {
  id: 'slide-up',
  name: 'Slide Up',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Slide the incoming clip in from below over the outgoing clip',
  recipe: [
    {
      kind: 'transform',
      target: 'incoming',
      translateY: { from: 1, to: 0 },
      curve: 'linear',
    },
  ],
};
