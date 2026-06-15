import type { TransitionDefinition } from '../types';

export const swirl: TransitionDefinition = {
  id: 'swirl',
  name: 'Swirl',
  category: 'stylize',
  defaultDuration: 1.15,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Center-weighted swirl distortion twists the cut',
  params: {
    seed: {
      type: 'number',
      label: 'Seed',
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
    },
  },
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.22,
      endProgress: 0.82,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.88,
      curve: 'ease-out',
    },
    {
      kind: 'distortion',
      target: 'outgoing',
      distortion: 'swirl',
    },
    {
      kind: 'distortion',
      target: 'incoming',
      distortion: 'swirl',
    },
  ],
};
