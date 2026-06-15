// Push Left Transition
// Pushes the outgoing clip left as the incoming clip enters from the right.

import type { TransitionDefinition } from '../types';

export const pushLeft: TransitionDefinition = {
  id: 'push-left',
  name: 'Push Left',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Push the outgoing clip left while the incoming clip enters from the right',
  recipe: [
    {
      kind: 'transform',
      target: 'outgoing',
      translateX: { from: 0, to: -1 },
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'incoming',
      translateX: { from: 1, to: 0 },
      curve: 'linear',
    },
  ],
};
