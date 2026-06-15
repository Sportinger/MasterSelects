import { describe, expect, it } from 'vitest';

import { additiveDissolve } from '../../src/transitions/additiveDissolve';

describe('additive dissolve transition definition', () => {
  it('brightens the midpoint with a transition-scoped add blend', () => {
    expect(additiveDissolve).toMatchObject({
      id: 'additive-dissolve',
      name: 'Additive Dissolve',
      category: 'dissolve',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Bright dissolve that adds the incoming clip through the midpoint',
    });
    expect(additiveDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.12,
      endProgress: 0.88,
      curve: 'ease-in',
    });
    expect(additiveDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.06,
      endProgress: 0.86,
      curve: 'ease-out',
    });
    expect(additiveDissolve.recipe).toContainEqual({
      kind: 'blend',
      target: 'incoming',
      mode: 'add',
      startProgress: 0.04,
      endProgress: 0.92,
    });
    expect(JSON.parse(JSON.stringify(additiveDissolve.recipe))).toEqual(additiveDissolve.recipe);
  });
});
