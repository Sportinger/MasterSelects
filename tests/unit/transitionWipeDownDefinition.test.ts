import { describe, expect, it } from 'vitest';

import { wipeDown } from '../../src/transitions/wipeDown';

describe('wipeDown transition definition', () => {
  it('defines a serializable downward wipe recipe for the incoming clip', () => {
    expect(wipeDown.id).toBe('wipe-down');
    expect(wipeDown.name).toBe('Wipe Down');
    expect(wipeDown.category).toBe('wipe');
    expect(wipeDown.defaultDuration).toBe(2);
    expect(wipeDown.minDuration).toBe(0.1);
    expect(wipeDown.maxDuration).toBe(5.0);

    const serializedRecipe = JSON.parse(JSON.stringify(wipeDown.recipe));

    expect(serializedRecipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'wipe',
        direction: 'down',
      },
    ]);
  });
});
