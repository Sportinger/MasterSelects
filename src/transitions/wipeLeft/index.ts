// Wipe Left Transition
// Reveals the incoming clip with a leftward screen-space wipe.

import type { TransitionDefinition } from '../types';

export const wipeLeft: TransitionDefinition = {
  id: 'wipe-left',
  name: 'Wipe Left',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Reveal the incoming clip with a leftward wipe',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'wipe',
      direction: 'left',
    },
  ],
};
