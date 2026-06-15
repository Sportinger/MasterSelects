// Center Wipe Transition
// Reveals the incoming clip from the center outward.

import type { TransitionDefinition } from '../types';

export const centerWipe: TransitionDefinition = {
  id: 'center-wipe',
  name: 'Center Wipe',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Center reveals incoming from the center outward',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'center',
      axis: 'x',
    },
  ],
};
