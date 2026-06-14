import { describe, expect, it } from 'vitest';

import {
  getAllTransitions,
  getCategoriesWithTransitions,
  getTransition,
  getTransitionsByCategory,
  type TransitionPrimitive,
} from '../../src/transitions';

describe('transition registry', () => {
  it('registers the full first-pass transition suite with serializable recipes', () => {
    const transitions = getAllTransitions();

    expect(transitions.map((transition) => transition.id)).toEqual([
      'crossfade',
      'dip-to-black',
      'dip-to-white',
      'wipe-left',
      'wipe-right',
    ]);

    for (const transition of transitions) {
      expect(transition.defaultDuration).toBeGreaterThan(0);
      expect(transition.minDuration).toBeGreaterThan(0);
      if (transition.maxDuration !== undefined) {
        expect(transition.maxDuration).toBeGreaterThanOrEqual(transition.defaultDuration);
      }
      expect(transition.recipe.length).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(transition.recipe)) as TransitionPrimitive[]).toEqual(transition.recipe);
    }
  });

  it('groups dissolve and wipe transitions by category', () => {
    expect(getTransitionsByCategory('dissolve').map((transition) => transition.id)).toEqual([
      'crossfade',
      'dip-to-black',
      'dip-to-white',
    ]);
    expect(getTransitionsByCategory('wipe').map((transition) => transition.id)).toEqual([
      'wipe-left',
      'wipe-right',
    ]);
    expect(getCategoriesWithTransitions().map((entry) => entry.category)).toEqual(['dissolve', 'wipe']);
  });

  it('defines first-pass render models through primitive recipes', () => {
    expect(getTransition('crossfade')?.recipe).toEqual([
      expect.objectContaining({ kind: 'opacity', target: 'incoming', from: 0, to: 1 }),
    ]);
    expect(getTransition('dip-to-black')?.recipe).toContainEqual({ kind: 'solid', color: '#000000' });
    expect(getTransition('dip-to-white')?.recipe).toContainEqual({ kind: 'solid', color: '#ffffff' });
    expect(getTransition('wipe-left')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'left' },
    ]);
    expect(getTransition('wipe-right')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'right' },
    ]);
  });
});
