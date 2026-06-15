import type { TransitionDefinition } from '../types';

export const kaleidoscope: TransitionDefinition = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'stylize',
  defaultDuration: 1.15,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Mirrored prism refraction through the cut using the registered Kaleidoscope effect',
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.24,
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
      effectType: 'kaleidoscope',
      effectName: 'Kaleidoscope',
      params: {
        segments: { from: 5, to: 14 },
        rotation: { from: 0, to: Math.PI * 2 },
      },
      startProgress: 0,
      endProgress: 0.72,
      curve: 'ease-in',
    },
    {
      kind: 'effect',
      target: 'incoming',
      effectType: 'kaleidoscope',
      effectName: 'Kaleidoscope',
      params: {
        segments: { from: 14, to: 6 },
        rotation: { from: -Math.PI * 2, to: 0 },
      },
      startProgress: 0.28,
      endProgress: 1,
      curve: 'ease-out',
    },
  ],
};
