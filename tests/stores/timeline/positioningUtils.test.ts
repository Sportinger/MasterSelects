import { describe, expect, it } from 'vitest';
import { createMockClip } from '../../helpers/mockData';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('positioningUtils', () => {
  it('snaps video clip edges to audio clip edges across track types', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
    });
    const audioTarget = createMockClip({
      id: 'audio-target',
      trackId: 'audio-1',
      startTime: 10,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'audio', naturalDuration: 2 },
    });
    const store = createTestTimelineStore({ clips: [movingVideo, audioTarget] });

    const result = store.getState().getSnappedPosition('video-moving', 11.9, 'video-1');

    expect(result).toMatchObject({
      startTime: 12,
      snapped: true,
      snapEdgeTime: 12,
    });
  });

  it('does not use the linked audio partner as a cross-type snap target', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      linkedClipId: 'audio-linked',
    });
    const linkedAudio = createMockClip({
      id: 'audio-linked',
      trackId: 'audio-1',
      startTime: 5,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      linkedClipId: 'video-moving',
      source: { type: 'audio', naturalDuration: 4 },
    });
    const store = createTestTimelineStore({ clips: [movingVideo, linkedAudio] });

    const result = store.getState().getSnappedPosition('video-moving', 8.9, 'video-1');

    expect(result).toMatchObject({
      startTime: 8.9,
      snapped: false,
      snapEdgeTime: 0,
    });
  });

  it('lets MIDI clips overlap freely without forcing-overlap (stack policy)', () => {
    const movingMidi = createMockClip({
      id: 'midi-moving',
      trackId: 'midi-1',
      startTime: 8,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'midi', naturalDuration: 4 },
    });
    const midiTarget = createMockClip({
      id: 'midi-target',
      trackId: 'midi-1',
      startTime: 4,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'midi', naturalDuration: 4 },
    });
    const store = createTestTimelineStore({
      tracks: [{ id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 60, muted: false, visible: true, solo: false }],
      clips: [movingMidi, midiTarget],
    });

    // Dropping the moving clip on top of the target lands exactly where requested
    // and is never flagged as a forced overlap.
    const result = store.getState().getPositionWithResistance('midi-moving', 5, 'midi-1', 4);
    expect(result).toMatchObject({ startTime: 5, forcingOverlap: false });
  });

  it('never eats overlapping clips on a MIDI track (trim is a no-op)', () => {
    const placed = createMockClip({
      id: 'midi-placed',
      trackId: 'midi-1',
      startTime: 5,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'midi', naturalDuration: 4 },
    });
    const underneath = createMockClip({
      id: 'midi-underneath',
      trackId: 'midi-1',
      startTime: 4,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'midi', naturalDuration: 4 },
    });
    const store = createTestTimelineStore({
      tracks: [{ id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 60, muted: false, visible: true, solo: false }],
      clips: [placed, underneath],
    });

    store.getState().trimOverlappingClips('midi-placed', 5, 'midi-1', 4);

    // Both clips survive untouched — they cohabitate.
    const after = store.getState().clips.find(c => c.id === 'midi-underneath');
    expect(store.getState().clips).toHaveLength(2);
    expect(after).toMatchObject({ startTime: 4, duration: 4 });
  });

  it('snaps an overlapping audio move into nearby free space', () => {
    const movingAudio = createMockClip({
      id: 'audio-moving',
      trackId: 'audio-1',
      startTime: 8,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'audio', naturalDuration: 2 },
    });
    const occupiedAudio = createMockClip({
      id: 'audio-occupied',
      trackId: 'audio-1',
      startTime: 4,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'audio', naturalDuration: 2 },
    });
    const store = createTestTimelineStore({ clips: [movingAudio, occupiedAudio] });

    const result = store.getState().getPositionWithResistance(
      'audio-moving',
      3.5,
      'audio-1',
      2,
      50,
    );

    expect(result).toEqual({ startTime: 2, forcingOverlap: false });
  });

  it('marks an audio lane occupied when the nearest free position is too far away', () => {
    const movingAudio = createMockClip({
      id: 'audio-moving',
      trackId: 'audio-1',
      startTime: 10,
      duration: 2,
      inPoint: 0,
      outPoint: 2,
      source: { type: 'audio', naturalDuration: 2 },
    });
    const occupiedAudio = createMockClip({
      id: 'audio-occupied',
      trackId: 'audio-1',
      startTime: 0,
      duration: 10,
      inPoint: 0,
      outPoint: 10,
      source: { type: 'audio', naturalDuration: 10 },
    });
    const store = createTestTimelineStore({ clips: [movingAudio, occupiedAudio] });

    const result = store.getState().getPositionWithResistance(
      'audio-moving',
      4,
      'audio-1',
      2,
      100,
    );

    expect(result).toEqual({ startTime: 4, forcingOverlap: false, noFreeSpace: true });
  });

  it('never trims an existing audio clip through the overlap helper', () => {
    const placed = createMockClip({
      id: 'audio-placed',
      trackId: 'audio-1',
      startTime: 5,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'audio', naturalDuration: 4 },
    });
    const underneath = createMockClip({
      id: 'audio-underneath',
      trackId: 'audio-1',
      startTime: 4,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: { type: 'audio', naturalDuration: 4 },
    });
    const store = createTestTimelineStore({ clips: [placed, underneath] });

    store.getState().trimOverlappingClips('audio-placed', 5, 'audio-1', 4);

    expect(store.getState().clips).toEqual([placed, underneath]);
  });

  it('snaps clip start and end to the playhead', () => {
    const movingVideo = createMockClip({
      id: 'video-moving',
      trackId: 'video-1',
      startTime: 0,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
    });
    const store = createTestTimelineStore({
      clips: [movingVideo],
      playheadPosition: 10,
    });

    expect(store.getState().getSnappedPosition('video-moving', 9.96, 'video-1')).toMatchObject({
      startTime: 10,
      snapped: true,
      snapEdgeTime: 10,
    });
    expect(store.getState().getSnappedPosition('video-moving', 7.04, 'video-1')).toMatchObject({
      startTime: 7,
      snapped: true,
      snapEdgeTime: 10,
    });
  });
});
