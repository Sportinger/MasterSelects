// Wipe Down Transition
// Reveals the incoming clip with a downward screen-space wipe.

import type { TransitionDefinition } from '../types';

export const wipeDown: TransitionDefinition = {
  id: 'wipe-down',
  name: 'Wipe Down',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Reveal the incoming clip with a downward wipe',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'wipe',
      direction: 'down',
    },
  ],
};
