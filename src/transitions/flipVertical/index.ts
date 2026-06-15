// Flip Vertical Transition
// Flips outgoing and incoming clips around the horizontal axis.

import type { TransitionDefinition } from '../types';

export const flipVertical: TransitionDefinition = {
  id: 'flip-vertical',
  name: 'Flip Vertical',
  category: '3d',
  renderMode: 'scene-3d-panel',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Flip between clips around the horizontal axis',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.45,
      endProgress: 0.5,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.5,
      endProgress: 0.55,
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: Math.PI / 2 },
      translateZ: { from: 0, to: -0.12 },
      endProgress: 0.5,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -Math.PI / 2, to: 0 },
      translateZ: { from: -0.12, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    },
  ],
};
