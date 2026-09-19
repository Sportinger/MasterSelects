import { describe, expect, it } from 'vitest';
import {
  gridStepSeconds,
  shouldSnap,
  snapContentTime,
  snapNoteDuration,
  type PianoRollSnapContext,
} from '../../src/components/pianoRoll/pianoRollSnap';
import { createDefaultTempoMap } from '../../src/timeline/tempo/rulerDefaults';

// Default map is constant 4/4 @ 60 BPM: beats on integer seconds, bars every 4s.
// The clip window starts at ABSOLUTE 10s with inPoint 2s, so content time 2 sits
// on absolute 10 — a deliberate offset in BOTH axes, because a snapper that
// forgets either one still passes when they are zero.
const base: PianoRollSnapContext = {
  tempoMap: createDefaultTempoMap(),
  clipStartTime: 10,
  inPoint: 2,
  pxPerSec: 100,
  subdivision: 'beat',
};

describe('snapContentTime', () => {
  it('snaps to the nearest beat through the content↔absolute round trip', () => {
    // Content 2.4 → absolute 10.4 → nearest beat 10 → back to content 2.
    expect(snapContentTime(base, 2.4)).toBeCloseTo(2);
    // Content 2.6 → absolute 10.6 → nearest beat 11 → content 3.
    expect(snapContentTime(base, 2.6)).toBeCloseTo(3);
  });

  it('snaps to 1/16 lines when the division is finer', () => {
    const ctx = { ...base, subdivision: '1/16' as const };
    // 1/16 lines are 0.25s apart: absolute 10.3 → 10.25 → content 2.25.
    expect(snapContentTime(ctx, 2.3)).toBeCloseTo(2.25);
  });

  it('snaps only to bar starts for the bar division', () => {
    const ctx = { ...base, subdivision: 'bar' as const };
    // Absolute 10.4 sits in bar 3 [8,12); the nearest bar start is 12 → content 4.
    expect(snapContentTime(ctx, 2.4)).toBeCloseTo(4);
  });

  it('handles a negative inPoint (left-extended clip)', () => {
    // Window left edge is absolute 10 at content -1, so content 0 is absolute 11.
    const ctx = { ...base, inPoint: -1 };
    expect(snapContentTime(ctx, 0.4)).toBeCloseTo(0);
    expect(snapContentTime(ctx, 0.6)).toBeCloseTo(1);
  });

  it('falls back to the coarser lines the zoom still draws', () => {
    // 1 px/s: beats (and therefore 1/16s) are thinned away, bars are not. The
    // request for 1/16 degrades to the nearest BAR rather than snapping to a
    // line that is not on screen — "you can only snap to what you can see".
    const ctx = { ...base, pxPerSec: 1, subdivision: '1/16' as const };
    expect(snapContentTime(ctx, 2.4)).toBeCloseTo(4); // absolute 12, bar 4
  });

  it('leaves the time untouched when the window holds no lines at all', () => {
    // A window entirely before absolute 0 has no musical time in it.
    const ctx = { ...base, clipStartTime: -1000 };
    expect(snapContentTime(ctx, 2.4)).toBe(2.4);
  });
});

describe('gridStepSeconds', () => {
  it('reports the spacing of the active division', () => {
    expect(gridStepSeconds(base, 2)).toBeCloseTo(1);
    expect(gridStepSeconds({ ...base, subdivision: '1/8' }, 2)).toBeCloseTo(0.5);
    expect(gridStepSeconds({ ...base, subdivision: '1/16' }, 2)).toBeCloseTo(0.25);
  });

  it('reports the coarser spacing once the zoom thins the fine lines out', () => {
    // Beats are gone at 1 px/s, so the step is a whole 4/4 bar.
    expect(gridStepSeconds({ ...base, pxPerSec: 1, subdivision: '1/16' }, 2)).toBeCloseTo(4);
  });

  it('is null when the window holds no lines at all', () => {
    expect(gridStepSeconds({ ...base, clipStartTime: -1000 }, 2)).toBeNull();
  });
});

describe('snapNoteDuration', () => {
  it('snaps the note end and keeps at least one grid unit', () => {
    // Start content 2 (absolute 10), pointer at 3.4 (absolute 11.4) → end 11 →
    // content 3 → duration 1.
    expect(snapNoteDuration(base, 2, 3.4, 0.02)).toBeCloseTo(1);
  });

  it('floors a backwards drag at one grid unit instead of a sliver', () => {
    expect(snapNoteDuration(base, 2, 2.01, 0.02)).toBeCloseTo(1);
    expect(snapNoteDuration(base, 2, 1.5, 0.02)).toBeCloseTo(1);
  });

  it('falls back to the un-snapped floor when there is no grid', () => {
    const ctx = { ...base, clipStartTime: -1000 };
    expect(snapNoteDuration(ctx, 2, 2.005, 0.02)).toBeCloseTo(0.02);
  });
});

describe('shouldSnap', () => {
  const plain = { altKey: false, shiftKey: false };

  it('follows the toggle when no modifier is held', () => {
    expect(shouldSnap(true, plain)).toBe(true);
    expect(shouldSnap(false, plain)).toBe(false);
  });

  it('lets Shift temporarily enable snapping while the toggle is off', () => {
    expect(shouldSnap(false, { altKey: false, shiftKey: true })).toBe(true);
  });

  it('lets Alt bypass snapping, even together with Shift', () => {
    expect(shouldSnap(true, { altKey: true, shiftKey: false })).toBe(false);
    expect(shouldSnap(false, { altKey: true, shiftKey: true })).toBe(false);
  });
});
