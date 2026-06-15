// Rotate Right Transition
// Rotates through the cut clockwise with a clean opacity handoff.

import type { TransitionDefinition } from '../types';

export const rotateRight: TransitionDefinition = {
  id: 'rotate-right',
  name: 'Rotate Right',
  category: 'rotate',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Rotate clockwise through the cut with a clean geometric dissolve',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.12,
      endProgress: 0.82,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.88,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: 0.42 },
      scaleX: { from: 1, to: 0.88 },
      scaleY: { from: 1, to: 0.88 },
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateZ: { from: -0.42, to: 0 },
      scaleX: { from: 1.12, to: 1 },
      scaleY: { from: 1.12, to: 1 },
      curve: 'ease-out',
    },
  ],
};
