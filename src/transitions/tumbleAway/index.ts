// Tumble Away Transition
// Kicks the outgoing clip back in Z while incoming settles into place.

import type { TransitionDefinition } from '../types';

export const tumbleAway: TransitionDefinition = {
  id: 'tumble-away',
  name: 'Tumble Away',
  category: '3d',
  renderMode: 'scene-3d-panel',
  defaultDuration: 1.3,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Tumble the outgoing clip backward as the next clip settles in',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.25,
      endProgress: 0.78,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.32,
      endProgress: 0.88,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.92 },
      rotateY: { from: 0, to: -0.56 },
      rotateZ: { from: 0, to: -0.18 },
      translateY: { from: 0, to: 0.18 },
      translateZ: { from: 0, to: -0.28 },
      scaleX: { from: 1, to: 0.72 },
      scaleY: { from: 1, to: 0.72 },
      endProgress: 0.78,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -0.18, to: 0 },
      rotateY: { from: 0.16, to: 0 },
      translateY: { from: -0.08, to: 0 },
      translateZ: { from: -0.18, to: 0 },
      scaleX: { from: 0.92, to: 1 },
      scaleY: { from: 0.92, to: 1 },
      startProgress: 0.32,
      curve: 'ease-out',
    },
  ],
};
