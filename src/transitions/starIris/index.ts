// Star Iris Transition
// Reveals the incoming clip from the center with a five-point star iris mask.

import type { TransitionDefinition } from '../types';

export const starIris: TransitionDefinition = {
  id: 'star-iris',
  name: 'Star Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a star iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'star',
    },
  ],
};
