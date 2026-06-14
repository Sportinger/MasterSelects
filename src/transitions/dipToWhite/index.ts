// Dip to White Transition
// Fades through a generated white solid between clips.

import type { TransitionDefinition } from '../types';

export const dipToWhite: TransitionDefinition = {
  id: 'dip-to-white',
  name: 'Dip to White',
  category: 'dissolve',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Fade out to white, then fade the incoming clip up',
  recipe: [
    {
      kind: 'solid',
      color: '#ffffff',
    },
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0,
      endProgress: 0.5,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.5,
      endProgress: 1,
      curve: 'linear',
    },
  ],
};
