// CRT Collapse Transition
// Compresses the cut into a horizontal beam using transition layer transforms.

import type { TransitionDefinition } from '../types';

export const crtCollapse: TransitionDefinition = {
  id: 'crt-collapse',
  name: 'CRT Collapse',
  category: 'glitch',
  defaultDuration: 1.0,
  minDuration: 0.1,
  maxDuration: 4,
  description: 'Collapse the outgoing clip into a CRT-style horizontal beam',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.42,
      endProgress: 0.68,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.5,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 0.045 },
      endProgress: 0.5,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.08, to: 1 },
      scaleY: { from: 0.045, to: 1 },
      startProgress: 0.5,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
