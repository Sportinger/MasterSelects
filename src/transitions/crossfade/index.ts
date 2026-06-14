// Crossfade Transition
// Simple opacity-based dissolve between two clips

import type { TransitionDefinition } from '../types';

export const crossfade: TransitionDefinition = {
  id: 'crossfade',
  name: 'Crossfade',
  category: 'dissolve',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Smooth opacity blend between clips',
  params: {
    includeAudio: {
      type: 'boolean',
      label: 'Include audio',
      defaultValue: false,
    },
  },
  recipe: [
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      curve: 'linear',
    },
  ],
};
