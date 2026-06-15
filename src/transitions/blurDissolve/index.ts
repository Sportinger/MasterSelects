import type { TransitionDefinition } from '../types';

export const blurDissolve: TransitionDefinition = {
  id: 'blur-dissolve',
  name: 'Blur Dissolve',
  category: 'dissolve',
  defaultDuration: 1.1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Cross dissolve with animated Gaussian blur on both clips',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.18,
      endProgress: 0.86,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.14,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'effect',
      target: 'outgoing',
      effectType: 'gaussian-blur',
      effectName: 'Gaussian Blur',
      params: {
        radius: { from: 0, to: 28 },
        samples: 11,
      },
      startProgress: 0,
      endProgress: 0.88,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'gaussian-blur',
      effectName: 'Gaussian Blur',
      params: {
        radius: { from: 28, to: 0 },
        samples: 11,
      },
      startProgress: 0.12,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
