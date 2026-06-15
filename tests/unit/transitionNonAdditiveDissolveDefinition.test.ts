import { describe, expect, it } from 'vitest';

import { nonAdditiveDissolve } from '../../src/transitions/nonAdditiveDissolve';

describe('non-additive dissolve transition definition', () => {
  it('darkens the midpoint with a transition-scoped multiply blend', () => {
    expect(nonAdditiveDissolve).toMatchObject({
      id: 'non-additive-dissolve',
      name: 'Non-Additive Dissolve',
      category: 'dissolve',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Darker dissolve that multiplies the incoming clip through the midpoint',
    });
    expect(nonAdditiveDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.12,
      endProgress: 0.88,
      curve: 'ease-in',
    });
    expect(nonAdditiveDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.06,
      endProgress: 0.86,
      curve: 'ease-out',
    });
    expect(nonAdditiveDissolve.recipe).toContainEqual({
      kind: 'blend',
      target: 'incoming',
      mode: 'multiply',
      startProgress: 0.04,
      endProgress: 0.92,
    });
    expect(JSON.parse(JSON.stringify(nonAdditiveDissolve.recipe))).toEqual(nonAdditiveDissolve.recipe);
  });
});
