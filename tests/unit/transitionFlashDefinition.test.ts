import { describe, expect, it } from 'vitest';

import { flash } from '../../src/transitions/flash';

describe('flash transition definition', () => {
  it('defines a serializable light flash recipe', () => {
    expect(flash).toMatchObject({
      id: 'flash',
      name: 'Flash',
      category: 'light',
      defaultDuration: 0.8,
      minDuration: 0.1,
      maxDuration: 3,
      description: 'Brief white flash over the cut with a fast dissolve underneath',
    });

    expect(JSON.parse(JSON.stringify(flash.recipe))).toEqual(flash.recipe);
    expect(flash.recipe).toEqual([
      { kind: 'solid', color: '#ffffff' },
      {
        kind: 'opacity',
        target: 'solid',
        from: 0,
        to: 0.92,
        startProgress: 0,
        endProgress: 0.42,
        curve: 'ease-out',
      },
      {
        kind: 'opacity',
        target: 'solid',
        from: 0.92,
        to: 0,
        startProgress: 0.42,
        endProgress: 1,
        curve: 'ease-in',
      },
      {
        kind: 'opacity',
        target: 'outgoing',
        from: 1,
        to: 0,
        startProgress: 0.2,
        endProgress: 0.65,
        curve: 'ease-in-out',
      },
      {
        kind: 'opacity',
        target: 'incoming',
        from: 0,
        to: 1,
        startProgress: 0.35,
        endProgress: 0.8,
        curve: 'ease-in-out',
      },
    ]);
  });
});
