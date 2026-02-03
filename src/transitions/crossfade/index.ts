// Crossfade Transition
// Simple opacity-based dissolve between two clips

import type { TransitionDefinition, TransitionKeyframe } from '../types';

export const crossfade: TransitionDefinition = {
  id: 'crossfade',
  name: 'Crossfade',
  category: 'dissolve',
  icon: 'Blend',
  defaultDuration: 0.5,
  minDuration: 0.1,
  maxDuration: 5.0,
  description: 'Smooth opacity blend between clips',

  getOutgoingKeyframes: (duration: number): TransitionKeyframe[] => [
    { time: 0, property: 'opacity', value: 1 },
    { time: duration, property: 'opacity', value: 0 },
  ],

  getIncomingKeyframes: (duration: number): TransitionKeyframe[] => [
    { time: 0, property: 'opacity', value: 0 },
    { time: duration, property: 'opacity', value: 1 },
  ],
};
