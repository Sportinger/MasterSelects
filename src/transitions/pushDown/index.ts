// Push Down Transition
// Pushes the outgoing clip down as the incoming clip enters from above.

import type { TransitionDefinition } from '../types';

export const pushDown: TransitionDefinition = {
  id: 'push-down',
  name: 'Push Down',
  category: 'slide',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Push the outgoing clip down while the incoming clip enters from above',
  recipe: [
    {
      kind: 'transform',
      target: 'outgoing',
      translateY: { from: 0, to: 1 },
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'incoming',
      translateY: { from: -1, to: 0 },
      curve: 'linear',
    },
  ],
};
