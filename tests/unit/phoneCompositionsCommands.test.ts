import { describe, expect, it } from 'vitest';

import {
  clampPhoneCompositionDuration, cleanPhoneCompositionName, nextPhoneCompositionName, phoneCompositionUsers, phoneFormatOf,
  phoneUserCompositions, planPhoneCompositionDelete,
} from '../../src/components/mobileSkin/compositions/phoneCompositionCommands';
import { nextPhoneCompositionTrail, phoneCompositionBackStep } from '../../src/components/mobileSkin/compositions/phoneCompositionTrail';

type Comp = Parameters<typeof planPhoneCompositionDelete>[0][number];

function comp(id: string, extra: Partial<Comp> = {}): Comp {
  return { id, name: id.toUpperCase(), transitionComp: undefined, captionComp: undefined, timelineData: undefined, ...extra } as Comp;
}

const transitionChild = comp('t', { transitionComp: { kind: 'transition-comp', parentCompositionId: 'a' } as Comp['transitionComp'] });

describe('phone composition commands', () => {
  it('lists only user-visible compositions (private transition compositions stay hidden)', () => {
    expect(phoneUserCompositions([comp('a'), transitionChild, comp('b')]).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('never deletes the last user-visible composition, even when private ones exist', () => {
    const plan = planPhoneCompositionDelete([comp('a'), transitionChild], 'a', 'a');
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/at least one composition/);
  });

  it('deleting the open composition switches to the next neighbour, else the previous one', () => {
    const list = [comp('a'), comp('b'), comp('c')];
    expect(planPhoneCompositionDelete(list, 'b', 'b')).toEqual({ ok: true, switchTo: 'c', users: [] });
    expect(planPhoneCompositionDelete(list, 'c', 'c')).toEqual({ ok: true, switchTo: 'b', users: [] });
    expect(planPhoneCompositionDelete(list, 'a', 'c')).toEqual({ ok: true, switchTo: null, users: [] });
  });

  it('names the compositions that nest the one being deleted', () => {
    const parent = comp('p', { timelineData: { clips: [{ id: 'x', compositionId: 'n' }] } as unknown as Comp['timelineData'] });
    expect(phoneCompositionUsers([parent, comp('n')], 'n')).toEqual(['P']);
    const plan = planPhoneCompositionDelete([parent, comp('n')], 'p', 'n');
    expect(plan.ok && plan.users).toEqual(['P']);
  });

  it('cleans names, clamps durations and finds free default names', () => {
    expect(cleanPhoneCompositionName('  Intro  ')).toBe('Intro');
    expect(cleanPhoneCompositionName('x'.repeat(300))).toHaveLength(200);
    expect(clampPhoneCompositionDuration(0)).toBe(1);
    expect(clampPhoneCompositionDuration(12.4)).toBe(12);
    expect(clampPhoneCompositionDuration(Number.NaN)).toBe(60);
    expect(clampPhoneCompositionDuration(99_999)).toBe(3600);
    expect(nextPhoneCompositionName([{ name: 'Comp 2' }, { name: 'Other' }])).toBe('Comp 3');
    expect(nextPhoneCompositionName([{ name: 'Comp 2' }])).toBe('Comp 3');
  });

  it('maps a composition size to the phone format chip', () => {
    expect(phoneFormatOf(1920, 1080)).toBe('16:9');
    expect(phoneFormatOf(1080, 1920)).toBe('9:16');
    expect(phoneFormatOf(1280, 720)).toBeNull();
  });
});

describe('phone composition trail', () => {
  it('offers the way back only while the entered composition is open', () => {
    const trail = nextPhoneCompositionTrail([], 'main', 'nested');
    expect(phoneCompositionBackStep(trail, 'nested')).toEqual({ parentId: 'main', childId: 'nested' });
    expect(phoneCompositionBackStep(trail, 'main')).toBeNull();
    expect(phoneCompositionBackStep([], 'nested')).toBeNull();
  });

  it('entering deeper extends the trail; entering an ancestor cuts it back', () => {
    let trail = nextPhoneCompositionTrail([], 'main', 'a');
    trail = nextPhoneCompositionTrail(trail, 'a', 'b');
    expect(trail).toHaveLength(2);
    expect(nextPhoneCompositionTrail(trail, 'b', 'a')).toEqual([{ parentId: 'main', childId: 'a' }]);
    expect(nextPhoneCompositionTrail(trail, 'b', 'main')).toEqual([]);
  });
});
