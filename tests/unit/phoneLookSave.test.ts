// "Save as look" on the phone (G2, INV-2/custom-look-stacks): a clip's visual effect stack becomes a
// saved Look in the editor's look store, the phone names what a Look leaves out, and an empty stack
// or name is refused with a reason.
import { beforeEach, describe, expect, it } from 'vitest';

import { planPhoneLookSave, savePhoneLook } from '../../src/components/mobileSkin/effects/phoneLookSave';
import { useLookStore } from '../../src/effects/looks/lookStore';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';

const blur: Effect = { id: 'fx-1', name: 'Blur', type: 'gaussian-blur', enabled: true, params: { radius: 8 } };
const invert: Effect = { id: 'fx-2', name: 'Invert', type: 'invert', enabled: false, params: {} };

beforeEach(() => {
  useLookStore.setState({ customLooks: [] });
});

describe('phone save as look', () => {
  it('saves the visual stack with on/off and values into the look store', () => {
    const result = savePhoneLook('  Night  ', [blur, invert]);
    expect(result.ok).toBe(true);
    const saved = useLookStore.getState().customLooks;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Night', category: 'custom', builtIn: false });
    expect(saved[0].stack.map((entry) => [entry.effectId, entry.enabled])).toEqual([['gaussian-blur', true], ['invert', false]]);
    expect(saved[0].stack[0].params.radius).toBe(8);
  });

  it('names the animation a look does not keep', () => {
    const keys: Keyframe[] = [
      { id: 'k', clipId: 'c', property: 'effect.fx-1.radius', time: 0, value: 2, easing: 'linear' },
      { id: 'k2', clipId: 'c', property: 'opacity', time: 0, value: 1, easing: 'linear' },
    ];
    const plan = planPhoneLookSave([blur], keys);
    expect(plan.stack).toHaveLength(1);
    expect(plan.notes).toEqual(['1 effect keyframe (a Look keeps the values at rest, not the animation)']);
    expect(planPhoneLookSave([blur], []).notes).toEqual([]);
  });

  it('refuses an empty name or stack with a reason', () => {
    expect(savePhoneLook(' ', [blur])).toMatchObject({ ok: false, message: expect.stringMatching(/name/) });
    expect(savePhoneLook('Empty', [])).toMatchObject({ ok: false, message: expect.stringMatching(/no effects/) });
    expect(useLookStore.getState().customLooks).toHaveLength(0);
  });
});
