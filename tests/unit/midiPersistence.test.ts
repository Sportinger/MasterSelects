// MIDI persistence round-trip (issue #182, Phase 5).
//
// Verifies that a MIDI track's instrument and a MIDI clip's notes survive the
// in-memory serialize → clear → load cycle (getSerializableState / loadState),
// which is the same data path projectSave/projectLoad persist to disk.

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

    store.setTrackMidiInstrument(trackId, { waveform: 'sawtooth', gain: 0.5 });
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
});
