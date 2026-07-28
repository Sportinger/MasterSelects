import { describe, expect, it } from 'vitest';

import {
  remapAcrossMaps,
  remapMidiClip,
  remapTimelineClipsForTempo,
  trackFollowsTempo,
} from '../../src/timeline/tempo/tempoRemap';
import { normalizeTempoMap } from '../../src/timeline/tempo/tempoEdits';
import { noteAbsoluteStart } from '../../src/services/midi/midiClipTiming';
import type { TimelineClip, TimelineTrack, TempoMap } from '../../src/types/timeline';
import type { MidiNote } from '../../src/types/midiClip';

const at = (bpm: number, numerator = 4, denominator = 4): TempoMap => normalizeTempoMap({
  events: [{ id: 'a', time: 0, bpm, numerator, denominator }],
});

const AT_120 = at(120);
const AT_60 = at(60);

function note(overrides: Partial<MidiNote> = {}): MidiNote {
  return { id: 'n1', pitch: 60, start: 0, duration: 1, velocity: 0.8, ...overrides };
}

function midiClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-midi',
    trackId: 'midi-1',
    name: 'MIDI',
    file: new File([], 'midi.dat'),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'midi', naturalDuration: 4 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes: [note()] },
    ...overrides,
  };
}

function videoClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-video',
    trackId: 'video-1',
    name: 'Video',
    file: new File([], 'v.mp4'),
    startTime: 1.234,
    duration: 5.678,
    inPoint: 0.5,
    outPoint: 6.178,
    source: { type: 'video', naturalDuration: 10 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...overrides,
  };
}

const TRACKS: TimelineTrack[] = [
  { id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 40, muted: false, visible: true, solo: false },
  { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false },
];

describe('remapAcrossMaps', () => {
  it('halving the tempo doubles absolute time', () => {
    expect(remapAcrossMaps(AT_120, AT_60, 2)).toBeCloseTo(4, 9);
    expect(remapAcrossMaps(AT_120, AT_60, 0)).toBeCloseTo(0, 9);
  });

  it('round-trips 120 -> 60 -> 120 within epsilon', () => {
    for (const time of [0, 0.37, 1, 4.5, 13.75, 60]) {
      const there = remapAcrossMaps(AT_120, AT_60, time);
      expect(remapAcrossMaps(AT_60, AT_120, there)).toBeCloseTo(time, 9);
    }
  });

  it('handles NEGATIVE times — the below-first-segment case', () => {
    // Reachable through a MIDI clip whose content origin sits before 0.
    expect(remapAcrossMaps(AT_120, AT_60, -1)).toBeCloseTo(-2, 9);
    expect(remapAcrossMaps(AT_60, AT_120, -4)).toBeCloseTo(-2, 9);
  });

  it('handles a negative time against a MULTI-segment map', () => {
    // The regression this packet fixes: with >1 segment the old walk fell
    // through to the LAST segment and returned nonsense for bar <= 0.
    const twoSegments = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'b', time: 8, bpm: 60, numerator: 4, denominator: 4 },
      ],
    });
    // -1 s is a full bar before the origin at 120 BPM; at 60 BPM that is -2 s.
    expect(remapAcrossMaps(twoSegments, AT_60, -1)).toBeCloseTo(-2, 9);
    expect(remapAcrossMaps(AT_60, twoSegments, -2)).toBeCloseTo(-1, 9);
  });

  it('remaps across a tempo boundary rather than scaling by a constant', () => {
    // 120 BPM until 8 s (4 bars), then 60 BPM.
    const changing = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'b', time: 8, bpm: 60, numerator: 4, denominator: 4 },
      ],
    });
    // 8 s is the downbeat of bar 5 (4 bars of 2 s). 10 s is 2 s further, which
    // at 60 BPM is 2 beats => bar 5 beat 3. At a flat 120 those 2 beats are 1 s,
    // so the answer is 8 + 1 = 9 s — NOT 10 s scaled by any single factor.
    expect(remapAcrossMaps(changing, AT_120, 10)).toBeCloseTo(9, 9);
  });
});

describe('trackFollowsTempo', () => {
  it('is true for MIDI and false for linear media', () => {
    expect(trackFollowsTempo({ type: 'midi' })).toBe(true);
    expect(trackFollowsTempo({ type: 'video' })).toBe(false);
    expect(trackFollowsTempo({ type: 'audio' })).toBe(false);
  });
});

describe('remapMidiClip', () => {
  it('120 -> 60 doubles every note start and duration', () => {
    const clip = midiClip({
      midiData: { notes: [note({ id: 'n1', start: 0, duration: 1 }), note({ id: 'n2', start: 2, duration: 0.5 })] },
    });
    const result = remapMidiClip(clip, AT_120, AT_60);

    expect(result.startTime).toBeCloseTo(0, 9);
    expect(result.duration).toBeCloseTo(8, 9);
    expect(result.midiData!.notes[0]).toMatchObject({ id: 'n1' });
    expect(result.midiData!.notes[0].start).toBeCloseTo(0, 9);
    expect(result.midiData!.notes[0].duration).toBeCloseTo(2, 9);
    expect(result.midiData!.notes[1].start).toBeCloseTo(4, 9);
    expect(result.midiData!.notes[1].duration).toBeCloseTo(1, 9);
  });

  it('keeps notes locked to the clip window (noteAbsoluteStart stays exact)', () => {
    const clip = midiClip({
      startTime: 3, duration: 4, inPoint: 1, outPoint: 5,
      midiData: { notes: [note({ start: 2 })] },
    });
    const before = noteAbsoluteStart(clip, clip.midiData!.notes[0]);
    const result = remapMidiClip(clip, AT_120, AT_60);
    const after = noteAbsoluteStart(result, result.midiData!.notes[0]);

    expect(result.startTime).toBeCloseTo(remapAcrossMaps(AT_120, AT_60, clip.startTime), 9);
    expect(after).toBeCloseTo(before * 2, 9);
  });

  it('survives a clip with NEGATIVE inPoint (left-extended clip)', () => {
    const clip = midiClip({
      startTime: 2, duration: 4, inPoint: -2, outPoint: 2,
      midiData: { notes: [note({ id: 'left', start: -1, duration: 0.5 })] },
    });
    const result = remapMidiClip(clip, AT_120, AT_60);

    expect(Number.isFinite(result.startTime)).toBe(true);
    expect(result.inPoint).toBeCloseTo(-4, 9);
    expect(result.outPoint).toBeCloseTo(4, 9);
    expect(result.startTime).toBeCloseTo(4, 9);
    expect(result.midiData!.notes[0].start).toBeCloseTo(-2, 9);
    expect(result.midiData!.notes[0].duration).toBeCloseTo(1, 9);
  });

  it('moves CC automation points with the notes they shape', () => {
    const clip = midiClip({
      midiData: { notes: [note({ start: 1, duration: 1 })] },
      automation: {
        cutoff: { points: [{ time: 0, value: 0.2 }, { time: 1, value: 0.9 }] },
        pitchBend: { points: [{ time: 2, value: 0.5 }] },
      },
    });
    const result = remapMidiClip(clip, AT_120, AT_60);

    // The cutoff point that sat on the note's start still sits on it.
    expect(result.automation!.cutoff!.points.map(p => p.time)).toEqual([0, 2]);
    expect(result.automation!.cutoff!.points[1].time)
      .toBeCloseTo(result.midiData!.notes[0].start, 9);
    expect(result.automation!.pitchBend!.points[0].time).toBeCloseTo(4, 9);
    // Values are untouched.
    expect(result.automation!.cutoff!.points.map(p => p.value)).toEqual([0.2, 0.9]);
  });

  it('derives note ends by remapping, not by scaling, across a tempo change', () => {
    const changing = normalizeTempoMap({
      events: [
        { id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 },
        { id: 'b', time: 4, bpm: 60, numerator: 4, denominator: 4 },
      ],
    });
    // A note from 3 s to 5 s straddles the 4 s boundary in the OLD map.
    const clip = midiClip({
      duration: 10, outPoint: 10,
      midiData: { notes: [note({ start: 3, duration: 2 })] },
    });
    const result = remapMidiClip(clip, changing, AT_120);
    const remapped = result.midiData!.notes[0];

    expect(remapped.start).toBeCloseTo(remapAcrossMaps(changing, AT_120, 3), 9);
    expect(remapped.start + remapped.duration)
      .toBeCloseTo(remapAcrossMaps(changing, AT_120, 5), 9);
    // A constant 1x factor would have kept duration at 2; the real answer is 1.5.
    expect(remapped.duration).toBeCloseTo(1.5, 9);
  });

  it('returns the identical object when the maps agree', () => {
    const clip = midiClip();
    expect(remapMidiClip(clip, AT_120, AT_120)).toBe(clip);
  });
});

describe('remapTimelineClipsForTempo', () => {
  it('moves MIDI clips and leaves media clips byte-identical', () => {
    const midi = midiClip();
    const video = videoClip();
    const result = remapTimelineClipsForTempo([midi, video], TRACKS, AT_120, AT_60);

    expect(result[0]).not.toBe(midi);
    expect(result[0].duration).toBeCloseTo(8, 9);
    // Same object, not just equal values.
    expect(result[1]).toBe(video);
    expect(result[1]).toEqual(video);
  });

  it('keeps array identity when nothing musical exists', () => {
    const clips = [videoClip()];
    expect(remapTimelineClipsForTempo(clips, TRACKS, AT_120, AT_60)).toBe(clips);
  });

  it('keeps array identity when the maps are equal', () => {
    const clips = [midiClip()];
    expect(remapTimelineClipsForTempo(clips, TRACKS, AT_120, AT_120)).toBe(clips);
  });

  it('round-trips a whole timeline 120 -> 60 -> 120', () => {
    const clips = [midiClip({ startTime: 2, inPoint: 0.5, outPoint: 4.5, duration: 4 }), videoClip()];
    const there = remapTimelineClipsForTempo(clips, TRACKS, AT_120, AT_60);
    const back = remapTimelineClipsForTempo(there, TRACKS, AT_60, AT_120);

    expect(back[0].startTime).toBeCloseTo(clips[0].startTime, 9);
    expect(back[0].duration).toBeCloseTo(clips[0].duration, 9);
    expect(back[0].inPoint).toBeCloseTo(clips[0].inPoint, 9);
    expect(back[0].midiData!.notes[0].start).toBeCloseTo(clips[0].midiData!.notes[0].start, 9);
    expect(back[1]).toBe(clips[1]);
  });
});

// Issue #299: content is anchored to the QUARTER-NOTE position, not to bar/beat.
// A time signature only groups beats into bars — re-grouping must not move a
// single note, or the bars ruler ends up out of sync with the content under it.
describe('remapAcrossMaps — meter is grouping, not timing', () => {
  const at = (bpm: number, numerator: number, denominator: number): TempoMap =>
    normalizeTempoMap({ events: [{ id: 'a', time: 0, bpm, numerator, denominator }] });

  it('a 4/4 -> 3/4 change at the same BPM moves nothing', () => {
    const fourFour = at(60, 4, 4);
    const threeFour = at(60, 3, 4);
    for (const time of [0, 1, 2, 4, 6, 8, 13.75]) {
      expect(remapAcrossMaps(fourFour, threeFour, time)).toBeCloseTo(time, 9);
    }
  });

  it('holds for exotic meters too', () => {
    for (const [numerator, denominator] of [[7, 8], [5, 4], [12, 8], [1, 1]]) {
      const changed = at(60, numerator, denominator);
      expect(remapAcrossMaps(at(60, 4, 4), changed, 6)).toBeCloseTo(6, 9);
    }
  });

  it('a 6/8 change keeps quarter positions even though the BEAT unit changes', () => {
    // 4/4 counts quarters, 6/8 counts eighths — twice as many beats per second,
    // but a quarter still lasts the same 1 s at 60 BPM.
    expect(remapAcrossMaps(at(60, 4, 4), at(60, 6, 8), 5)).toBeCloseTo(5, 9);
  });

  it('a simultaneous tempo AND meter change moves only by the tempo ratio', () => {
    // 60 -> 120 halves every time; switching 4/4 -> 3/4 adds nothing on top.
    expect(remapAcrossMaps(at(60, 4, 4), at(120, 3, 4), 8)).toBeCloseTo(4, 9);
  });

  it('leaves MIDI clips untouched when only the meter changes', () => {
    const clips = [midiClip({ startTime: 2, duration: 4, inPoint: 0, outPoint: 4 })];
    const result = remapTimelineClipsForTempo(clips, TRACKS, at(60, 4, 4), at(60, 3, 4));
    // Same objects: nothing moved, so nothing re-rendered.
    expect(result[0]).toBe(clips[0]);
  });
});
