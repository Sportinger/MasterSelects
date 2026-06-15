import type { TransitionDefinition } from '../types';

export const rgbSplitGlitch: TransitionDefinition = {
  id: 'rgb-split-glitch',
  name: 'RGB Split Glitch',
  category: 'glitch',
  defaultDuration: 0.8,
  minDuration: 0.1,
  maxDuration: 3,
  description: 'Chromatic split through the cut using registered RGB Split passes',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.24,
      endProgress: 0.72,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.78,
      curve: 'ease-out',
    },
    {
      kind: 'effect',
      target: 'outgoing',
      effectType: 'rgb-split',
      effectName: 'RGB Split',
      params: {
        amount: { from: 0, to: 0.048 },
        angle: 0,
      },
      startProgress: 0,
      endProgress: 0.62,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'rgb-split',
      effectName: 'RGB Split',
      params: {
        amount: { from: 0.048, to: 0 },
        angle: 3.14159,
      },
      startProgress: 0.34,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
