// Triangle Iris Transition
// Reveals the incoming clip from the center with a triangular iris mask.

import type { TransitionDefinition } from '../types';

export const triangleIris: TransitionDefinition = {
  id: 'triangle-iris',
  name: 'Triangle Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a triangle iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'triangle',
    },
  ],
};
