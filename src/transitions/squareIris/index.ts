// Square Iris Transition
// Reveals the incoming clip from the center with a square iris mask.

import type { TransitionDefinition } from '../types';

export const squareIris: TransitionDefinition = {
  id: 'square-iris',
  name: 'Square Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a square iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'rect',
    },
  ],
};
