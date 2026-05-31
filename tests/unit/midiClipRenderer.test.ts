// Pure planner for offline MIDI export (issue #182, Phase 5). The OfflineAudio
// render itself needs WebAudio (covered by manual/integration); here we lock down
// the note/timing resolution that decides what actually gets rendered.

import { describe, expect, it } from 'vitest';
import { planMidiClipNotes } from '../../src/engine/audio/MidiClipRenderer';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { createDefaultMidiInstrument } from '../../src/types/midiClip';

function midiTrack(overrides?: Partial<TimelineTrack>): TimelineTrack {
  return {
    id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 40,
    muted: false, visible: true, solo: false,
    midiInstrument: createDefaultMidiInstrument(),
    ...overrides,
  };
}

function midiClip(notesList: NonNullable<TimelineClip['midiData']>['notes'], duration = 4): TimelineClip {
  return {
    id: 'clip-1', trackId: 'midi-1', name: 'MIDI Clip',
    file: new File([], 'midi-clip.dat'),
    startTime: 0, duration, inPoint: 0, outPoint: duration,
    source: { type: 'midi', naturalDuration: duration },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes: notesList },
  };
}

describe('planMidiClipNotes', () => {
  it('passes through in-bounds notes with clip-local timing', () => {
    const clip = midiClip([
      { id: 'n1', pitch: 60, start: 0.5, duration: 1, velocity: 0.8 },
      { id: 'n2', pitch: 64, start: 2.0, duration: 0.5, velocity: 0.6 },
    ]);
    const plan = planMidiClipNotes(clip, midiTrack());

    expect(plan.durationSeconds).toBe(4);
    expect(plan.notes).toHaveLength(2);
    expect(plan.notes[0]).toEqual({ pitch: 60, startTime: 0.5, duration: 1, velocity: 0.8 });
    expect(plan.notes[1]).toEqual({ pitch: 64, startTime: 2.0, duration: 0.5, velocity: 0.6 });
  });

  it('drops notes that begin at or after the clip end', () => {
    const clip = midiClip([
      { id: 'n1', pitch: 60, start: 3.9, duration: 0.2, velocity: 0.8 },
      { id: 'n2', pitch: 62, start: 4.0, duration: 0.2, velocity: 0.8 },
      { id: 'n3', pitch: 64, start: 5.0, duration: 0.2, velocity: 0.8 },
    ], 4);
    const plan = planMidiClipNotes(clip, midiTrack());

    expect(plan.notes.map(n => n.pitch)).toEqual([60]);
  });

  it('clamps a note body to the clip end', () => {
    const clip = midiClip([
      { id: 'n1', pitch: 60, start: 3.5, duration: 2, velocity: 0.8 },
    ], 4);
    const plan = planMidiClipNotes(clip, midiTrack());

    expect(plan.notes[0].duration).toBeCloseTo(0.5, 5);
  });

  it('falls back to the default instrument when the track has none', () => {
    const clip = midiClip([{ id: 'n1', pitch: 60, start: 0, duration: 1, velocity: 0.8 }]);
    const plan = planMidiClipNotes(clip, midiTrack({ midiInstrument: undefined }));

    expect(plan.instrument).toEqual(createDefaultMidiInstrument());
  });

  it('returns no notes for an empty clip', () => {
    const plan = planMidiClipNotes(midiClip([]), midiTrack());
    expect(plan.notes).toHaveLength(0);
  });
});
