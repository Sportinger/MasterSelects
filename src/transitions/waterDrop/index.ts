import type { TransitionDefinition } from '../types';

export const waterDrop: TransitionDefinition = {
  id: 'water-drop',
  name: 'Water Drop',
  category: 'stylize',
  defaultDuration: 1.2,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Radial ripple distortion expands through the cut',
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
      startProgress: 0.28,
      endProgress: 0.82,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.86,
      curve: 'ease-out',
    },
    {
      kind: 'distortion',
      target: 'outgoing',
      distortion: 'water-drop',
    },
    {
      kind: 'distortion',
      target: 'incoming',
      distortion: 'water-drop',
    },
  ],
};
