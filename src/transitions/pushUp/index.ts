// Push Up Transition
// Pushes the outgoing clip up as the incoming clip enters from below.

import type { TransitionDefinition } from '../types';

export const pushUp: TransitionDefinition = {
  id: 'push-up',
  name: 'Push Up',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Push the outgoing clip up while the incoming clip enters from below',
  recipe: [
    {
      kind: 'transform',
      target: 'outgoing',
      translateY: { from: 0, to: -1 },
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'incoming',
      translateY: { from: 1, to: 0 },
      curve: 'linear',
    },
  ],
};
