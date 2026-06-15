// Flash Transition
// Overexposes the cut with a short white flash while clips dissolve underneath.

import type { TransitionDefinition } from '../types';

export const flash: TransitionDefinition = {
  id: 'flash',
  name: 'Flash',
  category: 'light',
  defaultDuration: 0.8,
  minDuration: 0.1,
  maxDuration: 3,
  description: 'Brief white flash over the cut with a fast dissolve underneath',
  recipe: [
    {
      kind: 'solid',
      color: '#ffffff',
    },
    {
      kind: 'opacity',
      target: 'solid',
      from: 0,
      to: 0.92,
      startProgress: 0,
      endProgress: 0.42,
      curve: 'ease-out',
    },
    {
      kind: 'opacity',
      target: 'solid',
      from: 0.92,
      to: 0,
      startProgress: 0.42,
      endProgress: 1,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.2,
      endProgress: 0.65,
      curve: 'ease-in-out',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.35,
      endProgress: 0.8,
      curve: 'ease-in-out',
    },
  ],
};
