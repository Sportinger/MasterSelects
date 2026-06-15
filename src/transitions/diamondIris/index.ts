// Diamond Iris Transition
// Reveals the incoming clip from the center with a diamond iris mask.

import type { TransitionDefinition } from '../types';

export const diamondIris: TransitionDefinition = {
  id: 'diamond-iris',
  name: 'Diamond Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a diamond iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'diamond',
    },
  ],
};
