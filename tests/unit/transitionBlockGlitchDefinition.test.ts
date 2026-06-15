import { describe, expect, it } from 'vitest';

import { blockGlitch } from '../../src/transitions/blockGlitch';

describe('blockGlitch transition definition', () => {
  it('defines a serializable deterministic procedural block mask recipe', () => {
    expect(blockGlitch).toMatchObject({
      id: 'block-glitch',
      name: 'Block Glitch',
      category: 'glitch',
      defaultDuration: 0.9,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'Reveal the incoming clip through deterministic glitch blocks',
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

    expect(JSON.parse(JSON.stringify(blockGlitch.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'procedural',
        procedural: 'blocks',
      },
    ]);
  });
});
