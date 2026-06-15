import { describe, expect, it } from 'vitest';

import { wipeUp } from '../../src/transitions/wipeUp';

describe('wipeUp transition definition', () => {
  it('defines a serializable incoming wipe-up recipe', () => {
    expect(wipeUp).toMatchObject({
      id: 'wipe-up',
      name: 'Wipe Up',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5.0,
      description: 'Reveal the incoming clip with an upward wipe',
    });
    expect(wipeUp.recipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'wipe',
        direction: 'up',
      },
    ]);
    expect(JSON.parse(JSON.stringify(wipeUp.recipe))).toEqual(wipeUp.recipe);
  });
});
