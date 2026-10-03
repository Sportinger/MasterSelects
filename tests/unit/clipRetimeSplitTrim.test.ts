import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { resolveClipSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { splitClipSourceWindow, trimClipSourceEdge } from '../../src/services/timeline/retime/clipEdgeRetime';
import { applySplitAtTimesOperation } from '../../src/stores/timeline/editOperations/splitBatchOperations';
import { applyTrimEdgeToTimeOperation, applyRippleTrimEdgeToTimeOperation,
  applyRollingEditOperation, applySlideClipOperation } from '../../src/stores/timeline/editOperations/trimOperations';
import { computeTrimTiming, trimOriginalsFromClip } from '../../src/components/timeline/utils/clipTrimTiming';

vi.mock('../../src/stores/timeline/editOperations/activeCompositionFrameRate', () => ({ getActiveCompositionFrameRate: () => 30 }));
const track = createMockTrack({ id: 'v', type: 'video' });
const matrix = [1, 2, -1, -2].flatMap(speed => [false, true].map(reversed => ({ speed, reversed })));
function makeClip(speed = 2, reversed = true): TimelineClip {
  return createMockClip({ id: 'original', trackId: 'v', startTime: 10,
    duration: 8 / Math.abs(speed), inPoint: 3, outPoint: 11, speed, reversed,
    source: { type: 'video', naturalDuration: 20 } });
}
function sample(clip: TimelineClip, time: number): number {
  return resolveClipSourceTime(clip, time - clip.startTime).sourceTime;
}
function assertFrames(before: TimelineClip, after: TimelineClip, shift = 0) {
  for (let index = 0; index < 40; index++) {
    const time = after.startTime + after.duration * index / 40;
    expect(sample(after, time)).toBeCloseTo(sample(before, time + shift), 9);
  }
}

describe('split and trim preserve source frames', () => {
  it.each(matrix)('split speed=$speed reverse=$reversed', ({ speed, reversed }) => {
    const clip = makeClip(speed, reversed);
    const cut = clip.duration * 0.375;
    const first = { ...clip, duration: cut, ...splitClipSourceWindow(clip, 0, cut) };
    const second = { ...clip, startTime: clip.startTime + cut, duration: clip.duration - cut,
      ...splitClipSourceWindow(clip, cut, clip.duration) };
    assertFrames(clip, first); assertFrames(clip, second);
    const result = applySplitAtTimesOperation({ id: 'split', type: 'split-at-times',
      clipId: clip.id, times: [clip.startTime + cut, clip.startTime + clip.duration * 0.75],
    }, [clip], [track]);
    expect(result.warnings).toEqual([]);
    expect(result.clips).toHaveLength(3);
    result.clips.forEach(part => assertFrames(clip, part));
  });

  it.each(matrix)('left/right trim speed=$speed reverse=$reversed', ({ speed, reversed }) => {
    const clip = makeClip(speed, reversed);
    for (const edge of ['start', 'end'] as const) {
      const delta = edge === 'start' ? 1 : -1;
      const timing = computeTrimTiming(clip, edge === 'start' ? 'left' : 'right', trimOriginalsFromClip(clip), delta);
      const after = { ...clip, startTime: timing.newStartTime, duration: timing.newDuration,
        inPoint: timing.newInPoint, outPoint: timing.newOutPoint };
      assertFrames(clip, after);
      expect(trimClipSourceEdge(clip, edge, delta)).toMatchObject(
        edge === 'start' !== ((speed < 0) !== reversed)
          ? { inPoint: after.inPoint } : { outPoint: after.outPoint });
      const time = edge === 'start' ? clip.startTime + 1 : clip.startTime + clip.duration - 1;
      const result = applyTrimEdgeToTimeOperation({ id: 'trim', type: 'trim-edge-to-time',
        edge, time, clipIds: [clip.id] }, [clip], [track], new Set());
      expect(result.warnings).toEqual([]);
      assertFrames(clip, result.clips[0]);
    }
  });

  it('proves that changing inPoint on a reversed left trim shifted the old frames', () => {
    const before = makeClip();
    const old = { ...before, startTime: 11, duration: 3, inPoint: 5 };
    expect(sample(old, 11)).toBe(11);
    expect(sample(before, 11)).toBe(9);
    const correct = { ...before, startTime: 11, duration: 3, ...trimClipSourceEdge(before, 'start', 1) };
    assertFrames(before, correct);
  });

  it('preserves reversed ripple-trim content after the intentional timeline shift', () => {
    const clip = makeClip();
    const result = applyRippleTrimEdgeToTimeOperation({ id: 'ripple', type: 'ripple-trim-edge-to-time',
      edge: 'start', time: 11, clipIds: [clip.id] }, [clip], [track], new Set());
    assertFrames(clip, result.clips[0], 1);
  });

  it('keeps remaining frames in reversed rolling and slide neighbors', () => {
    const left = { ...makeClip(), id: 'left', startTime: 0 };
    const middle = { ...makeClip(), id: 'middle', startTime: 4 };
    const right = { ...makeClip(), id: 'right', startTime: 8 };
    const rolled = applyRollingEditOperation({ id: 'roll', type: 'rolling-edit', clipId: left.id,
      edge: 'end', time: 3 }, [left, middle], [track]);
    assertFrames(left, rolled.clips[0]);
    // The newly exposed head has no original timeline samples; compare overlap.
    for (const time of [4, 5, 6, 7]) expect(sample(rolled.clips[1], time)).toBeCloseTo(sample(middle, time));
    const slid = applySlideClipOperation({ id: 'slide', type: 'slide-clip', clipId: middle.id,
      timelineDelta: 1 }, [left, middle, right], [track]);
    for (const time of [0, 1, 2, 3]) expect(sample(slid.clips[0], time)).toBeCloseTo(sample(left, time));
    assertFrames(right, slid.clips[2]);
  });

  it('splits linked partners with their own speed and rejects a locked partner atomically', () => {
    const video = { ...makeClip(), linkedClipId: 'audio' };
    const audio = { ...makeClip(1, false), id: 'audio', trackId: 'a',
      duration: video.duration, outPoint: 7, linkedClipId: video.id,
      source: { type: 'audio' as const, naturalDuration: 20 } };
    const audioTrack = createMockTrack({ id: 'a', type: 'audio' });
    const operation = { id: 'linked-split', type: 'split-at-times' as const,
      clipId: video.id, times: [11] };
    const result = applySplitAtTimesOperation(operation, [video, audio], [track, audioTrack]);
    expect(result.clips).toHaveLength(4);
    for (const part of result.clips) assertFrames(part.trackId === 'v' ? video : audio, part);
    const locked = applySplitAtTimesOperation(operation, [video, audio],
      [track, { ...audioTrack, locked: true }]);
    expect(locked.clips).toEqual([video, audio]);
    expect(locked.changedClipIds).toEqual([]);
    expect(locked.warnings[0].code).toBe('track-locked');
  });

  it('retains the documented legacy window for speed-keyframed splits', () => {
    const clip = makeClip();
    const keys = [{ id: 'speed', clipId: clip.id, property: 'speed' as const,
      time: 0, value: 2, easing: 'linear' as const }];
    expect(splitClipSourceWindow(clip, 1, 3, keys)).toEqual({ inPoint: 4, outPoint: 6 });
  });
});
