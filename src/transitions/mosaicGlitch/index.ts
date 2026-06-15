import type { TransitionDefinition } from '../types';

export const mosaicGlitch: TransitionDefinition = {
  id: 'mosaic-glitch',
  name: 'Mosaic Glitch',
  category: 'glitch',
  defaultDuration: 0.9,
  minDuration: 0.1,
  maxDuration: 4,
  description: 'Pixelated mosaic breakup through the cut using registered Pixelate passes',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.28,
      endProgress: 0.78,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.2,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'effect',
      target: 'outgoing',
      effectType: 'pixelate',
      effectName: 'Pixelate',
      params: {
        size: { from: 1, to: 44 },
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'pixelate',
      effectName: 'Pixelate',
      params: {
        size: { from: 44, to: 1 },
      },
      startProgress: 0.34,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
