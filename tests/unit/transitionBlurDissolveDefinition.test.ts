import { describe, expect, it } from 'vitest';

import { blurDissolve } from '../../src/transitions/blurDissolve';

describe('blur dissolve transition definition', () => {
  it('cross dissolves while animating Gaussian blur on both participants', () => {
    expect(blurDissolve.id).toBe('blur-dissolve');
    expect(blurDissolve.category).toBe('dissolve');
    expect(blurDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'outgoing',
      from: 1,
      to: 0,
      startProgress: 0.18,
      endProgress: 0.86,
      curve: 'ease-in',
    });
    expect(blurDissolve.recipe).toContainEqual({
      kind: 'opacity',
      target: 'incoming',
      from: 0,
      to: 1,
      startProgress: 0.14,
      endProgress: 0.82,
      curve: 'ease-out',
    });
    expect(blurDissolve.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'gaussian-blur',
      effectName: 'Gaussian Blur',
      params: {
        radius: { from: 0, to: 28 },
        samples: 11,
      },
      startProgress: 0,
      endProgress: 0.88,
      curve: 'ease-in',
    });
    expect(blurDissolve.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'gaussian-blur',
      effectName: 'Gaussian Blur',
      params: {
        radius: { from: 28, to: 0 },
        samples: 11,
      },
      startProgress: 0.12,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
