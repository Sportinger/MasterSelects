import { describe, expect, it } from 'vitest';

import { rotate90 } from '../../src/transitions/rotate90';
import { rotateLeft } from '../../src/transitions/rotateLeft';
import { rotateRight } from '../../src/transitions/rotateRight';

describe('rotate transition definitions', () => {
  it('defines serializable rotate left and rotate right recipes', () => {
    expect(rotateLeft).toMatchObject({
      id: 'rotate-left',
      name: 'Rotate Left',
      category: 'rotate',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Rotate counter-clockwise through the cut with a clean geometric dissolve',
    });
    expect(rotateRight).toMatchObject({
      id: 'rotate-right',
      name: 'Rotate Right',
      category: 'rotate',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Rotate clockwise through the cut with a clean geometric dissolve',
    });
    expect(JSON.parse(JSON.stringify(rotateLeft.recipe))).toEqual(rotateLeft.recipe);
    expect(JSON.parse(JSON.stringify(rotateRight.recipe))).toEqual(rotateRight.recipe);
    expect(rotateLeft.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: -0.42 },
      scaleX: { from: 1, to: 0.88 },
      scaleY: { from: 1, to: 0.88 },
      curve: 'ease-in',
    });
    expect(rotateRight.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: 0.42 },
      scaleX: { from: 1, to: 0.88 },
      scaleY: { from: 1, to: 0.88 },
      curve: 'ease-in',
    });
  });

  it('defines a serializable rotate 90 recipe', () => {
    expect(rotate90).toMatchObject({
      id: 'rotate-90',
      name: 'Rotate 90',
      category: 'rotate',
      defaultDuration: 1.25,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Quarter-turn rotate through the cut with a sharp midpoint handoff',
    });
    expect(JSON.parse(JSON.stringify(rotate90.recipe))).toEqual(rotate90.recipe);
    expect(rotate90.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: -Math.PI / 2 },
      scaleX: { from: 1, to: 0.92 },
      scaleY: { from: 1, to: 0.92 },
      curve: 'ease-in',
    });
  });
});
