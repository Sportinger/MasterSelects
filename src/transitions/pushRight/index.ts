// Push Right Transition
// Pushes the outgoing clip right as the incoming clip enters from the left.

import type { TransitionDefinition } from '../types';

export const pushRight: TransitionDefinition = {
  id: 'push-right',
  name: 'Push Right',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Push the outgoing clip right while the incoming clip enters from the left',
  recipe: [
    {
      kind: 'transform',
      target: 'outgoing',
      translateX: { from: 0, to: 1 },
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'incoming',
      translateX: { from: -1, to: 0 },
      curve: 'linear',
    },
  ],
};
