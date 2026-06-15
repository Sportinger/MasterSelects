import type { TransitionDefinition } from '../types';

export const puzzlePush: TransitionDefinition = {
  id: 'puzzle-push',
  name: 'Puzzle Push',
  category: 'pattern',
  defaultDuration: 1.25,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Reveal the incoming clip as deterministic sliding puzzle panels',
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
      kind: 'multi-panel',
      target: 'incoming',
      rows: 4,
      columns: 4,
      order: 'row-major',
      motion: 'puzzle',
      seed: 0,
      stagger: 0.32,
      curve: 'ease-out',
    },
  ],
};
