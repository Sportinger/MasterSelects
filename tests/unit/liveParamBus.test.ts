import { describe, it, expect } from 'vitest';
import { liveParamBus } from '../../src/services/midi/instrumentParams/liveParamBus';
import {
  activeMidiClipAt,
  clipContentTimeAt,
} from '../../src/services/midi/instrumentParams/activeMidiClip';
import type { TimelineClip } from '../../src/types/timeline';

function midiClip(over: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'c', trackId: 't1', midiData: { notes: [] }, startTime: 0, duration: 4,
    inPoint: 0, outPoint: 4, ...over,
  } as TimelineClip;
}

describe('liveParamBus', () => {
  it('delivers the current value immediately on subscribe and on change', () => {
    const seen: (number | undefined)[] = [];
    liveParamBus.publish('p', 42);
    const unsub = liveParamBus.subscribe('p', (v) => seen.push(v));
    expect(seen).toEqual([42]);        // immediate current value
    liveParamBus.publish('p', 42);     // unchanged → no notify
    liveParamBus.publish('p', 7);
    expect(seen).toEqual([42, 7]);
    liveParamBus.reset();              // clears → undefined
    expect(seen).toEqual([42, 7, undefined]);
    unsub();
    liveParamBus.publish('p', 99);     // no listener → not seen
    expect(seen).toEqual([42, 7, undefined]);
  });
});

describe('activeMidiClipAt / clipContentTimeAt', () => {
  const clips: TimelineClip[] = [
    { ...midiClip({}), id: 'a', startTime: 0, duration: 4, inPoint: 0, outPoint: 4 } as TimelineClip,
    { ...midiClip({}), id: 'b', startTime: 4, duration: 4, inPoint: 2, outPoint: 6 } as TimelineClip,
  ];

  it('finds the clip under the playhead on the track, or undefined', () => {
    expect(activeMidiClipAt(clips, 't1', 1)?.id).toBe('a');
    expect(activeMidiClipAt(clips, 't1', 5)?.id).toBe('b');
    expect(activeMidiClipAt(clips, 't1', 99)).toBeUndefined();
    expect(activeMidiClipAt(clips, 'other', 1)).toBeUndefined();
  });

  it('maps global time to clip content time via the windowed model', () => {
    // clip b: inPoint 2, startTime 4 → content = inPoint + (t - startTime).
    expect(clipContentTimeAt(clips[1], 5)).toBeCloseTo(2 + (5 - 4), 6);
  });
});
