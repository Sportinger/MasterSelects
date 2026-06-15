// Cross Iris Transition
// Reveals the incoming clip from the center with a cross-shaped iris mask.

import type { TransitionDefinition } from '../types';

export const crossIris: TransitionDefinition = {
  id: 'cross-iris',
  name: 'Cross Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a cross iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'cross',
    },
  ],
};
