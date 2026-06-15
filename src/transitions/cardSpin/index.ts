// Card Spin Transition
// Spins through the cut with a small Z tilt for a camera-rendered card handoff.

import type { TransitionDefinition } from '../types';

export const cardSpin: TransitionDefinition = {
  id: 'card-spin',
  name: 'Card Spin',
  category: '3d',
  renderMode: 'scene-3d-panel',
  defaultDuration: 1.4,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Spin clips like a single card turning through the cut',
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
      rotateY: { from: 0, to: Math.PI / 2 },
      rotateZ: { from: 0, to: 0.08 },
      scaleX: { from: 1, to: 0.94 },
      scaleY: { from: 1, to: 0.94 },
      translateZ: { from: 0, to: -0.18 },
      endProgress: 0.5,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateY: { from: -Math.PI / 2, to: 0 },
      rotateZ: { from: -0.08, to: 0 },
      scaleX: { from: 0.94, to: 1 },
      scaleY: { from: 0.94, to: 1 },
      translateZ: { from: -0.18, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    },
  ],
};
