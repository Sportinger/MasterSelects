// Dip to Black Transition
// Fades through a generated black solid between clips.

import type { TransitionDefinition } from '../types';

export const dipToBlack: TransitionDefinition = {
  id: 'dip-to-black',
  name: 'Dip to Black',
  category: 'dissolve',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Fade out to black, then fade the incoming clip up',
  recipe: [
    {
      kind: 'solid',
      color: '#000000',
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
