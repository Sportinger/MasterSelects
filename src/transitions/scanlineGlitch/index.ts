import type { TransitionDefinition } from '../types';

export const scanlineGlitch: TransitionDefinition = {
  id: 'scanline-glitch',
  name: 'Scanline Glitch',
  category: 'glitch',
  defaultDuration: 0.85,
  minDuration: 0.1,
  maxDuration: 4,
  description: 'CRT scanline interference through the cut using registered Scanlines passes',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.26,
      endProgress: 0.74,
      curve: 'ease-in',
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.18,
      endProgress: 0.82,
      curve: 'ease-out',
    },
    {
      kind: 'effect',
      target: 'outgoing',
      effectType: 'scanlines',
      effectName: 'Scanlines',
      params: {
        density: { from: 7, to: 16 },
        opacity: { from: 0.12, to: 0.58 },
        speed: 0,
      },
      startProgress: 0,
      endProgress: 0.7,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'scanlines',
      effectName: 'Scanlines',
      params: {
        density: { from: 16, to: 7 },
        opacity: { from: 0.58, to: 0.12 },
        speed: 0,
      },
      startProgress: 0.3,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
