import type { TransitionDefinition } from '../types';

export const nonAdditiveDissolve: TransitionDefinition = {
  id: 'non-additive-dissolve',
  name: 'Non-Additive Dissolve',
  category: 'dissolve',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Darker dissolve that multiplies the incoming clip through the midpoint',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.12,
      endProgress: 0.88,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.06,
      endProgress: 0.86,
      curve: 'ease-out',
    },
    {
      kind: 'blend',
      target: 'incoming',
      mode: 'multiply',
      startProgress: 0.04,
      endProgress: 0.92,
    },
  ],
};
