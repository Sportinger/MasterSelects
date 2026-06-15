// Slide Down Transition
// Moves the incoming clip from above to center over the outgoing clip.

import type { TransitionDefinition } from '../types';

export const slideDown: TransitionDefinition = {
  id: 'slide-down',
  name: 'Slide Down',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Slide the incoming clip in from above over the outgoing clip',
  recipe: [
    {
      kind: 'transform',
      target: 'incoming',
      translateY: { from: -1, to: 0 },
      curve: 'linear',
    },
  ],
};
