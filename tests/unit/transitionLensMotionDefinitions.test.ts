import { describe, expect, it } from 'vitest';

import { directionalBlur } from '../../src/transitions/directionalBlur';
import { whipPan } from '../../src/transitions/whipPan';

describe('lens and motion blur transition definitions', () => {
  it('defines a directional blur dissolve through transition-scoped motion blur effects', () => {
    expect(directionalBlur).toMatchObject({
      id: 'directional-blur',
      name: 'Directional Blur',
      category: 'zoom',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Cross dissolve with horizontal motion blur on both clips',
    });
    expect(JSON.parse(JSON.stringify(directionalBlur.recipe))).toEqual(directionalBlur.recipe);
    expect(directionalBlur.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0, to: 0.11 },
        angle: 0,
        samples: 32,
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    });
    expect(directionalBlur.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0.11, to: 0 },
        angle: 0,
        samples: 32,
      },
      startProgress: 0.34,
      endProgress: 1,
      curve: 'ease-out',
    });
  });

  it('defines a horizontal whip pan with transform and motion blur primitives', () => {
    expect(whipPan).toMatchObject({
      id: 'whip-pan',
      name: 'Whip Pan',
      category: 'zoom',
      defaultDuration: 0.8,
      minDuration: 0.1,
      maxDuration: 3,
      description: 'Fast horizontal pan through the cut with motion blur',
    });
    expect(JSON.parse(JSON.stringify(whipPan.recipe))).toEqual(whipPan.recipe);
    expect(whipPan.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      translateX: { from: 0, to: -0.1 },
      scaleX: { from: 1, to: 1.18 },
      scaleY: { from: 1, to: 1.18 },
      startProgress: 0,
      endProgress: 0.68,
      curve: 'ease-in',
    });
    expect(whipPan.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0.16, to: 0 },
        angle: 0,
        samples: 40,
      },
      startProgress: 0.32,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
