// Spin Zoom Transition
// Adds a small rotational push to the clean zoom handoff.

import type { TransitionDefinition } from '../types';

export const spinZoom: TransitionDefinition = {
  id: 'spin-zoom',
  name: 'Spin Zoom',
  category: 'zoom',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Zoom through the cut with a restrained rotational push',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.18,
      endProgress: 0.82,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: 0.18 },
      scaleX: { from: 1, to: 0.9 },
      scaleY: { from: 1, to: 0.9 },
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateZ: { from: -0.18, to: 0 },
      scaleX: { from: 1.14, to: 1 },
      scaleY: { from: 1.14, to: 1 },
      curve: 'ease-out',
    },
  ],
};
