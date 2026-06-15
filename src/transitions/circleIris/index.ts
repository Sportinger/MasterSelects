// Circle Iris Transition
// Reveals the incoming clip from the center with a circular iris mask.

import type { TransitionDefinition } from '../types';

export const circleIris: TransitionDefinition = {
  id: 'circle-iris',
  name: 'Circle Iris',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center using a circle iris shape',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'shape',
      shape: 'circle',
    },
  ],
};
