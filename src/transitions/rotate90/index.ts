// Rotate 90 Transition
// Uses a stronger quarter-turn 2D card-like rotation around the cut.

import type { TransitionDefinition } from '../types';

export const rotate90: TransitionDefinition = {
  id: 'rotate-90',
  name: 'Rotate 90',
  category: 'rotate',
  defaultDuration: 1.25,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Quarter-turn rotate through the cut with a sharp midpoint handoff',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.36,
      endProgress: 0.5,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.5,
      endProgress: 0.64,
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: -Math.PI / 2 },
      scaleX: { from: 1, to: 0.92 },
      scaleY: { from: 1, to: 0.92 },
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateZ: { from: Math.PI / 2, to: 0 },
      scaleX: { from: 0.92, to: 1 },
      scaleY: { from: 0.92, to: 1 },
      curve: 'ease-out',
    },
  ],
};
