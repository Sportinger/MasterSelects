// MIDI persistence round-trip (issue #182, Phase 5).
//
// Verifies that a MIDI track's instrument and a MIDI clip's notes survive the
// in-memory serialize → clear → load cycle (getSerializableState / loadState).
// NOTE: this is the in-memory path (a `...track` spread). The on-disk path
// (projectSave/projectLoad) maps track fields explicitly and is covered separately
// in projectMediaPersistence.test.ts — they are NOT the same code.

import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';

const resetTimeline = () => {
  const store = useTimelineStore.getState();
  store.clearTimeline();
  store.clipKeyframes.clear();
};

describe('MIDI persistence round-trip', () => {
  beforeEach(() => {
    resetTimeline();
  });

  it('preserves track instrument and clip notes through serialize/load', async () => {
    const store = useTimelineStore.getState();
    const trackId = store.addTrack('midi');
    const clipId = store.addMidiClip(trackId, 1.5, 4);
    if (!clipId) throw new Error('Failed to create MIDI clip');

    // Explicit kind: new MIDI tracks now default to GM, so select the simple synth
    // before tweaking its oscillator-specific fields.
    store.setTrackMidiInstrument(trackId, { kind: 'simple-synth', waveform: 'sawtooth', gain: 0.5 });
    store.addMidiNote(clipId, { pitch: 64, start: 0.25, duration: 0.5, velocity: 0.7 });
    store.addMidiNote(clipId, { pitch: 67, start: 1.0, duration: 0.75, velocity: 0.9 });

    const serialized = useTimelineStore.getState().getSerializableState();

    // The serialized form must carry the notes + instrument (not just live state).
    const serializedTrack = serialized.tracks.find(t => t.id === trackId);
    const serializedClip = serialized.clips.find(c => c.id === clipId);
    expect(serializedTrack?.midiInstrument?.waveform).toBe('sawtooth');
    expect(serializedClip?.sourceType).toBe('midi');
    expect(serializedClip?.midiData?.notes).toHaveLength(2);

    // Round-trip through clear + load.
    resetTimeline();
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    await useTimelineStore.getState().loadState(serialized);

    const restored = useTimelineStore.getState();
    const restoredTrack = restored.tracks.find(t => t.id === trackId);
    const restoredClip = restored.clips.find(c => c.id === clipId);

    expect(restoredTrack?.type).toBe('midi');
    expect(restoredTrack?.midiInstrument?.waveform).toBe('sawtooth');
    expect(restoredTrack?.midiInstrument?.gain).toBe(0.5);

    expect(restoredClip?.source?.type).toBe('midi');
    expect(restoredClip?.startTime).toBeCloseTo(1.5);
    expect(restoredClip?.midiData?.notes).toHaveLength(2);
    const restoredNotes = [...(restoredClip?.midiData?.notes ?? [])].sort((a, b) => a.pitch - b.pitch);
    expect(restoredNotes[0]).toMatchObject({ pitch: 64, start: 0.25, duration: 0.5, velocity: 0.7 });
    expect(restoredNotes[1]).toMatchObject({ pitch: 67, start: 1.0, duration: 0.75, velocity: 0.9 });
  });

  it('preserves a GM program / drum-kit selection through serialize/load', async () => {
    const store = useTimelineStore.getState();
    const trackId = store.addTrack('midi');

    // Switch to GM, pick a melodic program, then flip to a drum kit.
    store.setTrackMidiInstrument(trackId, { kind: 'gm' });
    store.setTrackMidiInstrument(trackId, { program: 40 }); // Violin
    let instrument = useTimelineStore.getState().tracks.find(t => t.id === trackId)?.midiInstrument;
    expect(instrument).toMatchObject({ kind: 'gm', program: 40 });

    store.setTrackMidiInstrument(trackId, { isDrum: true, program: 0 }); // Standard Kit
    instrument = useTimelineStore.getState().tracks.find(t => t.id === trackId)?.midiInstrument;
    expect(instrument).toMatchObject({ kind: 'gm', program: 0, isDrum: true });
    // The shape swap must not leave stale simple-synth fields behind.
    expect(instrument && 'waveform' in instrument).toBe(false);
    expect(instrument && 'adsr' in instrument).toBe(false);

    const serialized = useTimelineStore.getState().getSerializableState();
    expect(serialized.tracks.find(t => t.id === trackId)?.midiInstrument).toMatchObject({
      kind: 'gm', program: 0, isDrum: true,
    });

    resetTimeline();
    await useTimelineStore.getState().loadState(serialized);

    const restored = useTimelineStore.getState().tracks.find(t => t.id === trackId)?.midiInstrument;
    expect(restored).toMatchObject({ kind: 'gm', program: 0, isDrum: true });
  });
});
