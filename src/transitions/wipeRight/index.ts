// Wipe Right Transition
// Reveals the incoming clip with a rightward screen-space wipe.

import type { TransitionDefinition } from '../types';

export const wipeRight: TransitionDefinition = {
  id: 'wipe-right',
  name: 'Wipe Right',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Reveal the incoming clip with a rightward wipe',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'wipe',
      direction: 'right',
    },
  ],
};
