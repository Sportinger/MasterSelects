import { describe, expect, it } from 'vitest';
import {
  checkAvLinkAlignment,
  checkNoGaps,
  checkNoOverlaps,
  checkObjectCount,
  checkOccupiedEnd,
  checkSourceOrderMonotonic,
  evaluateChecks,
} from '../../src/services/validationCore';
import { validateGuidedCheck } from '../../src/services/guidedActions/scenarios/validation';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const videoTrack: TimelineTrack = {
  id: 'video-1',
  name: 'Video',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

const audioTrack: TimelineTrack = {
  id: 'audio-1',
  name: 'Audio',
  type: 'audio',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

function clip(
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  overrides: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    trackId,
    name: id,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    ...overrides,
  } as TimelineClip;
}

describe('timeline validation core', () => {
  it('checks object counts positively and negatively', () => {
    const state = {
      clips: [clip('clip-1', 'video-1', 0, 2)],
      tracks: [videoTrack],
    };

    expect(checkObjectCount(state, 'clips', 1)).toEqual({
      check: 'objectCount',
      passed: true,
      expected: 1,
      actual: 1,
    });
    expect(checkObjectCount(state, 'tracks', 2).passed).toBe(false);
  });

  it('checks gaps positively and rejects a gapped timeline', () => {
    const contiguous = {
      clips: [
        clip('clip-1', 'video-1', 0, 2),
        clip('clip-2', 'video-1', 2, 2),
      ],
      tracks: [videoTrack],
    };
    const gapped = {
      ...contiguous,
      clips: [
        clip('clip-1', 'video-1', 0, 2),
        clip('clip-2', 'video-1', 3, 2),
      ],
    };

    expect(checkNoGaps(contiguous).passed).toBe(true);
    expect(checkNoGaps(gapped)).toEqual({
      check: 'noGaps',
      passed: false,
      expected: 0,
      actual: 1,
    });
  });

  it('checks overlaps positively and negatively', () => {
    const separated = {
      clips: [
        clip('clip-1', 'video-1', 0, 2),
        clip('clip-2', 'video-1', 2, 2),
      ],
      tracks: [videoTrack],
    };
    const overlapping = {
      ...separated,
      clips: [
        clip('clip-1', 'video-1', 0, 3),
        clip('clip-2', 'video-1', 2, 2),
      ],
    };

    expect(checkNoOverlaps(separated).passed).toBe(true);
    expect(checkNoOverlaps(overlapping).passed).toBe(false);
  });

  it('checks source order positively and negatively, with optional track scope', () => {
    const monotonic = {
      clips: [
        clip('clip-1', 'video-1', 0, 2, { inPoint: 2, outPoint: 4 }),
        clip('clip-2', 'video-1', 2, 2, { inPoint: 4, outPoint: 6 }),
      ],
      tracks: [videoTrack],
    };
    const reversed = {
      ...monotonic,
      clips: [
        clip('clip-1', 'video-1', 0, 2, { inPoint: 4, outPoint: 6 }),
        clip('clip-2', 'video-1', 2, 2, { inPoint: 2, outPoint: 4 }),
      ],
    };

    expect(checkSourceOrderMonotonic(monotonic, 'video-1').passed).toBe(true);
    expect(checkSourceOrderMonotonic(reversed).passed).toBe(false);
  });

  it('checks linked A/V alignment positively and negatively', () => {
    const aligned = {
      clips: [
        clip('video', 'video-1', 1, 4, { linkedClipId: 'audio' }),
        clip('audio', 'audio-1', 1, 4, { linkedClipId: 'video' }),
      ],
      tracks: [videoTrack, audioTrack],
    };
    const misaligned = {
      ...aligned,
      clips: [
        clip('video', 'video-1', 1, 4, { linkedClipId: 'audio' }),
        clip('audio', 'audio-1', 1.5, 4, { linkedClipId: 'video' }),
      ],
    };

    expect(checkAvLinkAlignment(aligned).passed).toBe(true);
    expect(checkAvLinkAlignment(misaligned).passed).toBe(false);
  });

  it('checks occupied end positively and negatively with tolerance', () => {
    const state = {
      clips: [clip('clip-1', 'video-1', 2, 3)],
      tracks: [videoTrack],
    };

    expect(checkOccupiedEnd(state, 5.005, 0.01).passed).toBe(true);
    expect(checkOccupiedEnd(state, 5.02, 0.01).passed).toBe(false);
  });

  it('evaluates registry checks in input order', () => {
    const state = {
      clips: [clip('clip-1', 'video-1', 0, 2)],
      tracks: [videoTrack],
    };

    expect(evaluateChecks([
      { check: 'objectCount', kind: 'clips', expected: 1 },
      { check: 'occupiedEnd', expected: 2 },
    ], state).map((result) => result.check)).toEqual([
      'objectCount',
      'occupiedEnd',
    ]);
  });

  it('keeps delegated guided validation behavior unchanged', () => {
    const timeline = {
      ...useTimelineStore.getState(),
      playheadPosition: 4.005,
    };

    expect(validateGuidedCheck(
      { kind: 'playheadAtTime', time: 4 },
      { timeline: () => timeline },
    ).success).toBe(true);
  });
});
