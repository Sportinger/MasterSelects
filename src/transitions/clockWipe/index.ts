// Clock Wipe Transition
// Reveals the incoming clip clockwise from 12 o'clock.

import type { TransitionDefinition } from '../types';

export const clockWipe: TransitionDefinition = {
  id: 'clock-wipe',
  name: 'Clock Wipe',
  category: 'wipe',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5,
  description: "Clock reveals clockwise from 12 o'clock",
  recipe: [
    {
      kind: 'mask',
      target: 'incoming',
      mask: 'clock',
      clockwise: true,
      angleOffset: 0,
    },
  ],
};
