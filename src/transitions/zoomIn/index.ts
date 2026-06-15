// Zoom In Transition
// Incoming clip settles from a slight push-in while outgoing fades down.

import type { TransitionDefinition } from '../types';

export const zoomIn: TransitionDefinition = {
  id: 'zoom-in',
  name: 'Zoom In',
  category: 'zoom',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Zoom into the incoming clip with a clean geometric dissolve',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.15,
      endProgress: 0.85,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.05,
      endProgress: 0.75,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 1.08 },
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.18, to: 1 },
      scaleY: { from: 1.18, to: 1 },
      curve: 'ease-out',
    },
  ],
};
