import { describe, expect, it } from 'vitest';

import { findNearestFreeStart, planPhoneMainTrackDrop } from '../../src/components/mobileSkin/actions/phoneReorderPlan';

const seq = [
  { id: 'a', startTime: 0, duration: 2 },
  { id: 'b', startTime: 2, duration: 3 },
  { id: 'c', startTime: 5, duration: 1 },
];

function startsAfter(plan: ReturnType<typeof planPhoneMainTrackDrop>, clips = seq): Record<string, number> {
  const starts = Object.fromEntries(clips.map((clip) => [clip.id, clip.startTime]));
  if (plan.kind === 'reorder') for (const move of plan.moves) starts[move.clipId] = move.startTime;
  return starts;
}

describe('phone main-track drop plan', () => {
  it('moves the first clip to the end and lays the sequence back to back', () => {
    const plan = planPhoneMainTrackDrop({ trackClips: seq, draggedClipId: 'a', dropStart: 4.8, draggedDuration: 2 });

    expect(plan.kind).toBe('reorder');
    if (plan.kind !== 'reorder') return;
    expect(plan.order).toEqual(['b', 'c', 'a']);
    expect(startsAfter(plan)).toEqual({ b: 0, c: 3, a: 4 });
  });

  it('moves the last clip to the front', () => {
    const plan = planPhoneMainTrackDrop({ trackClips: seq, draggedClipId: 'c', dropStart: 0.2, draggedDuration: 1 });

    expect(plan.kind === 'reorder' && plan.order).toEqual(['c', 'a', 'b']);
    expect(startsAfter(plan)).toEqual({ c: 0, a: 1, b: 3 });
  });

  it('only re-lays the clips between the old and the new slot and keeps later gaps', () => {
    const clips = [...seq, { id: 'd', startTime: 10, duration: 2 }];
    const plan = planPhoneMainTrackDrop({ trackClips: clips, draggedClipId: 'a', dropStart: 3, draggedDuration: 2 });

    expect(plan.kind === 'reorder' && plan.order).toEqual(['b', 'a', 'c', 'd']);
    expect(startsAfter(plan, clips)).toEqual({ b: 0, a: 3, c: 5, d: 10 });
    expect(plan.kind === 'reorder' && plan.moves.map((move) => move.clipId).sort()).toEqual(['a', 'b']);
  });

  it('inserts a clip from another lane between clips and shifts the following clips', () => {
    const plan = planPhoneMainTrackDrop({ trackClips: seq, draggedClipId: 'x', dropStart: 1.5, draggedDuration: 2 });

    expect(plan.kind === 'reorder' && plan.order).toEqual(['a', 'x', 'b', 'c']);
    if (plan.kind !== 'reorder') return;
    expect(Object.fromEntries(plan.moves.map((move) => [move.clipId, move.startTime]))).toEqual({ x: 2, b: 4, c: 7 });
  });

  it('keeps a drop into free space where it was dropped', () => {
    const clips = [{ id: 'a', startTime: 0, duration: 2 }, { id: 'b', startTime: 6, duration: 2 }];
    expect(planPhoneMainTrackDrop({ trackClips: clips, draggedClipId: 'x', dropStart: 3, draggedDuration: 2 }))
      .toEqual({ kind: 'free', startTime: 3 });
    expect(planPhoneMainTrackDrop({ trackClips: clips, draggedClipId: 'a', dropStart: -1, draggedDuration: 2 }))
      .toEqual({ kind: 'free', startTime: 0 });
  });

  it('snaps a clip dropped onto its own slot back to its position', () => {
    const plan = planPhoneMainTrackDrop({ trackClips: seq, draggedClipId: 'b', dropStart: 2.4, draggedDuration: 3 });

    expect(plan.kind === 'reorder' && plan.order).toEqual(['a', 'b', 'c']);
    expect(plan.kind === 'reorder' && plan.moves).toEqual([{ clipId: 'b', startTime: 2 }]);
  });
});

describe('nearest free start on a secondary lane', () => {
  const lane = [{ id: 'p', startTime: 2, duration: 2 }, { id: 'q', startTime: 6, duration: 2 }];

  it('keeps a free position', () => {
    expect(findNearestFreeStart(lane, 1, 4.5)).toBe(4.5);
  });

  it('snaps an overlapping drop to the nearest edge with room', () => {
    expect(findNearestFreeStart(lane, 1, 2.2)).toBe(1);
    expect(findNearestFreeStart(lane, 1.5, 5.5)).toBe(4.5);
    expect(findNearestFreeStart(lane, 3, 3)).toBe(8);
  });
});
