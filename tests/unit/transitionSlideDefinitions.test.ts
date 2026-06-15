import { describe, expect, it } from 'vitest';

import { slideDown } from '../../src/transitions/slideDown';
import { slideLeft } from '../../src/transitions/slideLeft';
import { slideRight } from '../../src/transitions/slideRight';
import { slideUp } from '../../src/transitions/slideUp';

describe('slide transition definitions', () => {
  it('defines a leftward incoming slide recipe', () => {
    expect(slideLeft).toMatchObject({
      id: 'slide-left',
      name: 'Slide Left',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Slide the incoming clip in from the right over the outgoing clip',
    });
    expect(slideLeft.recipe).toEqual([
      {
        kind: 'transform',
        target: 'incoming',
        translateX: { from: 1, to: 0 },
        curve: 'linear',
      },
    ]);
    expect(JSON.parse(JSON.stringify(slideLeft.recipe))).toEqual(slideLeft.recipe);
  });

  it('defines a rightward incoming slide recipe', () => {
    expect(slideRight).toMatchObject({
      id: 'slide-right',
      name: 'Slide Right',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Slide the incoming clip in from the left over the outgoing clip',
    });
    expect(slideRight.recipe).toEqual([
      {
        kind: 'transform',
        target: 'incoming',
        translateX: { from: -1, to: 0 },
        curve: 'linear',
      },
    ]);
    expect(JSON.parse(JSON.stringify(slideRight.recipe))).toEqual(slideRight.recipe);
  });

  it('defines an upward incoming slide recipe', () => {
    expect(slideUp).toMatchObject({
      id: 'slide-up',
      name: 'Slide Up',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Slide the incoming clip in from below over the outgoing clip',
    });
    expect(slideUp.recipe).toEqual([
      {
        kind: 'transform',
        target: 'incoming',
        translateY: { from: 1, to: 0 },
        curve: 'linear',
      },
    ]);
    expect(JSON.parse(JSON.stringify(slideUp.recipe))).toEqual(slideUp.recipe);
  });

  it('defines a downward incoming slide recipe', () => {
    expect(slideDown).toMatchObject({
      id: 'slide-down',
      name: 'Slide Down',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Slide the incoming clip in from above over the outgoing clip',
    });
    expect(slideDown.recipe).toEqual([
      {
        kind: 'transform',
        target: 'incoming',
        translateY: { from: -1, to: 0 },
        curve: 'linear',
      },
    ]);
    expect(JSON.parse(JSON.stringify(slideDown.recipe))).toEqual(slideDown.recipe);
  });
});
