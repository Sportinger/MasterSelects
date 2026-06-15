import { describe, expect, it } from 'vitest';

import { crtCollapse } from '../../src/transitions/crtCollapse';

describe('crtCollapse transition definition', () => {
  it('defines a serializable transform-based CRT collapse recipe', () => {
    expect(crtCollapse).toMatchObject({
      id: 'crt-collapse',
      name: 'CRT Collapse',
      category: 'glitch',
      defaultDuration: 1.0,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'Collapse the outgoing clip into a CRT-style horizontal beam',
    });

    expect(JSON.parse(JSON.stringify(crtCollapse.recipe))).toEqual(crtCollapse.recipe);
    expect(crtCollapse.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 0.045 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(crtCollapse.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.08, to: 1 },
      scaleY: { from: 0.045, to: 1 },
      startProgress: 0.5,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
