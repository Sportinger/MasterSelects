// Checker Wipe Transition
// Reveals the incoming clip through a deterministic checkerboard pattern.

import type { TransitionDefinition } from '../types';

export const checkerWipe: TransitionDefinition = {
  id: 'checker-wipe',
  name: 'Checker Wipe',
  category: 'pattern',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip through a checkerboard pattern',
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'pattern',
      pattern: 'checker',
    },
  ],
};
