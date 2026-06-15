// Oval Iris Transition
// Reveals the incoming clip from the center with a horizontal oval iris mask.

import type { TransitionDefinition } from '../types';

export const ovalIris: TransitionDefinition = {
  id: 'oval-iris',
  name: 'Oval Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using an oval iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'oval',
    },
  ],
};
