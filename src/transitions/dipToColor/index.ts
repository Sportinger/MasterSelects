// Dip to Color Transition
// Fades through a generated configurable color solid between clips.

import type { TransitionDefinition } from '../types';

export const dipToColor: TransitionDefinition = {
  id: 'dip-to-color',
  name: 'Dip to Color',
  category: 'dissolve',
  defaultDuration: 2,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Fade out to a custom color, then fade the incoming clip up',
  params: {
    color: {
      type: 'color',
      label: 'Color',
      defaultValue: '#000000',
    },
  },
  recipe: [
    {
      kind: 'solid',
      color: '#000000',
      colorParam: 'color',
    },
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0,
      endProgress: 0.5,
      curve: 'linear',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.5,
      endProgress: 1,
      curve: 'linear',
    },
  ],
};
