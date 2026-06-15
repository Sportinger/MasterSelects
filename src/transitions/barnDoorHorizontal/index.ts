// Barn Door Horizontal Transition
// Reveals the incoming clip outward from the vertical center line.

import type { TransitionDefinition } from '../types';

export const barnDoorHorizontal: TransitionDefinition = {
  id: 'barn-door-horizontal',
  name: 'Barn Door Horizontal',
  category: 'wipe',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center outward horizontally',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'center',
      axis: 'x',
    },
  ],
};
