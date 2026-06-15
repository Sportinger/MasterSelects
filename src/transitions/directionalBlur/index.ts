import type { TransitionDefinition } from '../types';

export const directionalBlur: TransitionDefinition = {
  id: 'directional-blur',
  name: 'Directional Blur',
  category: 'zoom',
  defaultDuration: 1,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Cross dissolve with horizontal motion blur on both clips',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.18,
      endProgress: 0.84,
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
      kind: 'effect',
      target: 'outgoing',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0, to: 0.11 },
        angle: 0,
        samples: 32,
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0.11, to: 0 },
        angle: 0,
        samples: 32,
      },
      startProgress: 0.34,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
