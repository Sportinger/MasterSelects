// 3D Roll Transition
// Rolls clips around the horizontal axis as camera-rendered textured panels.

import type { TransitionDefinition } from '../types';

export const roll3d: TransitionDefinition = {
  id: 'roll-3d',
  name: '3D Roll',
  category: '3d',
  renderMode: 'scene-3d-panel',
  defaultDuration: 1.3,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Roll clips through the cut around the horizontal axis',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.42,
      endProgress: 0.52,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.48,
      endProgress: 0.58,
      curve: 'linear',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: -Math.PI / 2 },
      rotateZ: { from: 0, to: -0.1 },
      translateY: { from: 0, to: -0.06 },
      translateZ: { from: 0, to: -0.16 },
      scaleX: { from: 1, to: 0.96 },
      scaleY: { from: 1, to: 0.96 },
      endProgress: 0.52,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: Math.PI / 2, to: 0 },
      rotateZ: { from: 0.1, to: 0 },
      translateY: { from: 0.06, to: 0 },
      translateZ: { from: -0.16, to: 0 },
      scaleX: { from: 0.96, to: 1 },
      scaleY: { from: 0.96, to: 1 },
      startProgress: 0.48,
      curve: 'ease-out',
    },
  ],
};
