// Zoom Out Transition
// Outgoing clip pulls back while incoming rises from a smaller scale.

import type { TransitionDefinition } from '../types';

export const zoomOut: TransitionDefinition = {
  id: 'zoom-out',
  name: 'Zoom Out',
  category: 'zoom',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Zoom out of the outgoing clip into the incoming clip',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.2,
      endProgress: 0.9,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.12,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 0.86 },
      scaleY: { from: 1, to: 0.86 },
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 0.86, to: 1 },
      scaleY: { from: 0.86, to: 1 },
      curve: 'ease-out',
    },
  ],
};
