// Magnetic Tiles Transition
// Reveals the incoming clip as deterministic panels pulled from the center.

import type { TransitionDefinition } from '../types';

export const magneticTiles: TransitionDefinition = {
  id: 'magnetic-tiles',
  name: 'Magnetic Tiles',
  category: 'pattern',
  defaultDuration: 1.25,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip as tiles attracted from a magnetic center',
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
  recipe: [{
    kind: 'multi-panel',
    target: 'incoming',
    rows: 4,
    columns: 5,
    order: 'magnetic',
    motion: 'magnetic',
    seed: 0,
    stagger: 0.24,
    curve: 'ease-in',
  }],
};
