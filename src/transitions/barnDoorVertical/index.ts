// Barn Door Vertical Transition
// Reveals the incoming clip outward from the horizontal center line.

import type { TransitionDefinition } from '../types';

export const barnDoorVertical: TransitionDefinition = {
  id: 'barn-door-vertical',
  name: 'Barn Door Vertical',
  category: 'wipe',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip from the center outward vertically',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'center',
      axis: 'y',
    },
  ],
};
