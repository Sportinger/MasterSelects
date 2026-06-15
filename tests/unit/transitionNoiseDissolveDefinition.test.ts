import { describe, expect, it } from 'vitest';

import { noiseDissolve } from '../../src/transitions/noiseDissolve';

describe('noiseDissolve transition definition', () => {
  it('defines a serializable deterministic procedural noise mask recipe', () => {
    expect(noiseDissolve).toMatchObject({
      id: 'noise-dissolve',
      name: 'Noise Dissolve',
      category: 'stylize',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through deterministic noise grain',
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
    });

    expect(JSON.parse(JSON.stringify(noiseDissolve.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'procedural',
        procedural: 'noise',
      },
    ]);
  });
});
