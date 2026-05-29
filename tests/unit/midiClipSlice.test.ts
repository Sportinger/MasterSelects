import { beforeEach, describe, expect, it } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../src/types';

function midiTrack(): TimelineTrack {
  return {
    id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 40,
    muted: false, visible: true, solo: false,
    midiInstrument: { kind: 'simple-synth', waveform: 'triangle', adsr: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 }, gain: 0.8 },
  };
}

function midiClip(): TimelineClip {
  return {
    id: 'clip-midi-1', trackId: 'midi-1', name: 'MIDI Clip',
    file: new File([], 'midi-clip.dat'),
    startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    source: { type: 'midi', naturalDuration: 4 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes: [] },
  };
}

describe('midiClipSlice note CRUD', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [midiTrack()],
      clips: [midiClip()],
      selectedClipIds: new Set(),
      playheadPosition: 0,
      isExporting: false,
      duration: 60,
    });
  });

  const getNotes = () => useTimelineStore.getState().clips.find(c => c.id === 'clip-midi-1')?.midiData?.notes ?? [];

  it('accumulates notes across multiple addMidiNote calls', () => {
    useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 60, start: 0.5, duration: 1 });
    useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 64, start: 1.5, duration: 1 });
    const notes = getNotes();
    expect(notes).toHaveLength(2);
    expect(notes.map(n => n.pitch).sort()).toEqual([60, 64]);
  });

  it('updates a single note without dropping others', () => {
    const a = useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 60, start: 0, duration: 0.02 })!;
    useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 62, start: 1, duration: 1 });
    useTimelineStore.getState().updateMidiNote('clip-midi-1', a, { duration: 2 }, { captureHistory: false });
    const notes = getNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find(n => n.id === a)?.duration).toBe(2);
  });

  it('removes only the targeted note', () => {
    const a = useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 60, start: 0, duration: 1 })!;
    useTimelineStore.getState().addMidiNote('clip-midi-1', { pitch: 62, start: 1, duration: 1 });
    useTimelineStore.getState().removeMidiNote('clip-midi-1', a);
    const notes = getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(62);
  });
});
