import { describe, expect, it } from 'vitest';
import {
  getMuscriptorGmInstrument,
  mapMuscriptorNotes,
  mapMuscriptorTimelineTranscription,
  MUSCRIPTOR_INSTRUMENT_GROUPS,
} from '../../src/services/muscriptor/eventMapping';

describe('MuScriptor event mapping', () => {
  it('maps every upstream instrument group to a playable GM instrument', () => {
    for (const group of MUSCRIPTOR_INSTRUMENT_GROUPS) {
      expect(getMuscriptorGmInstrument(group), group).not.toBeNull();
    }
    expect(getMuscriptorGmInstrument('drums')).toEqual({
      kind: 'gm', program: 0, isDrum: true, gain: 0.8,
    });
    expect(getMuscriptorGmInstrument('program_127')).toMatchObject({ program: 127 });
    expect(getMuscriptorGmInstrument('program_128')).toBeNull();
  });

  it('validates notes, groups deterministically, and applies safe MIDI defaults', () => {
    const input = [
      { pitch: 42, start_time: 1, end_time: 1, instrument: 'drums' },
      { pitch: 67, start_time: 0.5, end_time: 0.9, instrument: 'violin' },
      { pitch: 60, start_time: 0.1, end_time: 0.4, instrument: 'acoustic_piano' },
      { pitch: 64, start_time: 0.1, end_time: 0.2, instrument: 'acoustic_piano' },
      { pitch: 200, start_time: 0, end_time: 1, instrument: 'violin' },
      { pitch: 60, start_time: -1, end_time: 1, instrument: 'violin' },
      { pitch: 60, start_time: 0, end_time: 1, instrument: 'unknown' },
    ];

    const first = mapMuscriptorNotes(input);
    const second = mapMuscriptorNotes([...input].reverse());
    expect(first.map(track => track.instrumentGroup)).toEqual([
      'acoustic_piano', 'violin', 'drums',
    ]);
    expect(first.flatMap(track => track.notes)).toHaveLength(4);
    expect(first[0].notes.map(note => note.pitch)).toEqual([60, 64]);
    expect(first[2].notes[0]).toMatchObject({ duration: 0.02, velocity: 0.8 });
    expect(second.map(track => track.instrumentGroup)).toEqual(first.map(track => track.instrumentGroup));
    expect(second.flatMap(track => track.notes.map(note => ({
      pitch: note.pitch, start: note.start, duration: note.duration,
    })))).toEqual(first.flatMap(track => track.notes.map(note => ({
      pitch: note.pitch, start: note.start, duration: note.duration,
    }))));
  });

  it('exports a timeline-ready plain-data contract', () => {
    const mapped = mapMuscriptorTimelineTranscription({
      job_id: 'job-7',
      notes: [{ pitch: 60, start_time: 0, end_time: 1, instrument: 'acoustic_piano' }],
    }, {
      sourceAudioClipId: 'audio-1',
      sourceFingerprint: 'sha256:test',
      processingStateHash: 'processed:test',
      sourceFileKey: 'song.wav:audio/wav:12:34',
      timelineStart: 12,
      duration: 8,
    });

    expect(mapped).toMatchObject({
      jobId: 'job-7',
      sourceAudioClipId: 'audio-1',
      sourceFingerprint: 'sha256:test',
      processingStateHash: 'processed:test',
      sourceFileKey: 'song.wav:audio/wav:12:34',
      timelineStart: 12,
      duration: 8,
    });
    expect(mapped.tracks[0]).toMatchObject({
      instrumentId: 'acoustic_piano',
      gmProgram: 0,
      isDrum: false,
    });
    expect(mapped.tracks[0].notes[0].startTime).toBe(0);
  });
});
