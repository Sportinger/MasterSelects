// 3D Spinback Transition
// Spins both participants back in depth as camera-rendered textured panels.

import type { TransitionDefinition } from '../types';

export const spinback3d: TransitionDefinition = {
  id: 'spinback-3d',
  name: '3D Spinback',
  category: '3d',
  renderMode: 'scene-3d-panel',
  defaultDuration: 1.35,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Spin clips backward in depth through the cut',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.18,
      endProgress: 0.68,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.32,
      endProgress: 0.86,
      curve: 'ease-out',
    },
    {
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.36 },
      rotateY: { from: 0, to: -0.74 },
      rotateZ: { from: 0, to: -0.92 },
      translateZ: { from: 0, to: -0.34 },
      scaleX: { from: 1, to: 0.62 },
      scaleY: { from: 1, to: 0.62 },
      endProgress: 0.68,
      curve: 'ease-in',
    },
    {
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -0.24, to: 0 },
      rotateY: { from: 0.42, to: 0 },
      rotateZ: { from: 0.82, to: 0 },
      translateZ: { from: -0.32, to: 0 },
      scaleX: { from: 0.64, to: 1 },
      scaleY: { from: 0.64, to: 1 },
      startProgress: 0.32,
      curve: 'ease-out',
    },
  ],
};
