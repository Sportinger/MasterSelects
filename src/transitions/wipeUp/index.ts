// Wipe Up Transition
// Reveals the incoming clip with an upward screen-space wipe.

import type { TransitionDefinition } from '../types';

export const wipeUp: TransitionDefinition = {
  id: 'wipe-up',
  name: 'Wipe Up',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Reveal the incoming clip with an upward wipe',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'wipe',
      direction: 'up',
    },
  ],
};
