import { describe, expect, it } from 'vitest';

import { pushDown } from '../../src/transitions/pushDown';
import { pushLeft } from '../../src/transitions/pushLeft';
import { pushRight } from '../../src/transitions/pushRight';
import { pushUp } from '../../src/transitions/pushUp';

describe('push transition definitions', () => {
  it('defines serializable push-left transform vectors', () => {
    expect(pushLeft).toMatchObject({
      id: 'push-left',
      name: 'Push Left',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Push the outgoing clip left while the incoming clip enters from the right',
    });
    expect(JSON.parse(JSON.stringify(pushLeft.recipe))).toEqual([
      {
        kind: 'transform',
        target: 'outgoing',
        translateX: { from: 0, to: -1 },
        curve: 'linear',
      },
      {
        kind: 'transform',
        target: 'incoming',
        translateX: { from: 1, to: 0 },
        curve: 'linear',
      },
    ]);
  });

  it('defines serializable push-right transform vectors', () => {
    expect(pushRight).toMatchObject({
      id: 'push-right',
      name: 'Push Right',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Push the outgoing clip right while the incoming clip enters from the left',
    });
    expect(JSON.parse(JSON.stringify(pushRight.recipe))).toEqual([
      {
        kind: 'transform',
        target: 'outgoing',
        translateX: { from: 0, to: 1 },
        curve: 'linear',
      },
      {
        kind: 'transform',
        target: 'incoming',
        translateX: { from: -1, to: 0 },
        curve: 'linear',
      },
    ]);
  });

  it('defines serializable push-up transform vectors', () => {
    expect(pushUp).toMatchObject({
      id: 'push-up',
      name: 'Push Up',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Push the outgoing clip up while the incoming clip enters from below',
    });
    expect(JSON.parse(JSON.stringify(pushUp.recipe))).toEqual([
      {
        kind: 'transform',
        target: 'outgoing',
        translateY: { from: 0, to: -1 },
        curve: 'linear',
      },
      {
        kind: 'transform',
        target: 'incoming',
        translateY: { from: 1, to: 0 },
        curve: 'linear',
      },
    ]);
  });

  it('defines serializable push-down transform vectors', () => {
    expect(pushDown).toMatchObject({
      id: 'push-down',
      name: 'Push Down',
      category: 'slide',
      defaultDuration: 1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Push the outgoing clip down while the incoming clip enters from above',
    });
    expect(JSON.parse(JSON.stringify(pushDown.recipe))).toEqual([
      {
        kind: 'transform',
        target: 'outgoing',
        translateY: { from: 0, to: 1 },
        curve: 'linear',
      },
      {
        kind: 'transform',
        target: 'incoming',
        translateY: { from: -1, to: 0 },
        curve: 'linear',
      },
    ]);
  });
});
