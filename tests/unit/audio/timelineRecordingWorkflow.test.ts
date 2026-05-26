import { describe, expect, it } from 'vitest';
import { resolveTimelineRecordingRange } from '../../../src/services/audio/timelineRecordingWorkflow';

describe('timelineRecordingWorkflow', () => {
  it('uses the in/out range as a punch recording window when the playhead is before the in point', () => {
    expect(resolveTimelineRecordingRange({
      playheadPosition: 2,
      inPoint: 5,
      outPoint: 9,
      duration: 12,
    })).toEqual({
      mode: 'punch',
      startTime: 5,
      punchInTime: 5,
      punchOutTime: 9,
      invalidReason: undefined,
    });
  });

  it('starts from the current playhead when already inside the in/out range', () => {
    expect(resolveTimelineRecordingRange({
      playheadPosition: 6,
      inPoint: 5,
      outPoint: 9,
      duration: 12,
    })).toEqual({
      mode: 'punch',
      startTime: 6,
      punchInTime: 6,
      punchOutTime: 9,
      invalidReason: undefined,
    });
  });

  it('drops invalid punch-out windows that would end before the recording start', () => {
    expect(resolveTimelineRecordingRange({
      playheadPosition: 8,
      inPoint: 5,
      outPoint: 8,
      duration: 12,
    })).toEqual({
      mode: 'punch',
      startTime: 8,
      punchInTime: 8,
      punchOutTime: undefined,
      invalidReason: 'Out point is at or before the recording start.',
    });
  });
});
