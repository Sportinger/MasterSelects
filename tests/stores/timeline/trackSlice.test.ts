import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

describe('trackSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

  // ──────────────────────────────────────────────────
  // addTrack
  // ──────────────────────────────────────────────────

  it('addTrack(video): creates video track at top with correct defaults', () => {
    const id = store.getState().addTrack('video');
    const state = store.getState();
    const track = state.tracks.find(t => t.id === id);
    expect(track).toBeDefined();
    expect(track!.type).toBe('video');
    expect(track!.height).toBe(60);
    expect(track!.muted).toBe(false);
    expect(track!.visible).toBe(true);
    expect(track!.solo).toBe(false);
    // Video tracks insert at top
    expect(state.tracks[0].id).toBe(id);
  });

  it('addTrack(audio): creates audio track at bottom', () => {
    const id = store.getState().addTrack('audio');
    const state = store.getState();
    const track = state.tracks.find(t => t.id === id);
    expect(track).toBeDefined();
    expect(track!.type).toBe('audio');
    expect(track!.height).toBe(40);
    // Audio tracks append at end
    expect(state.tracks[state.tracks.length - 1].id).toBe(id);
  });

  it('addTrack auto-names: Video 2, Audio 2, etc.', () => {
    const videoId = store.getState().addTrack('video');
    const audioId = store.getState().addTrack('audio');
    const state = store.getState();
    // Initial has Video 1 + Audio 1, so new ones are Video 2, Audio 2
    expect(state.tracks.find(t => t.id === videoId)!.name).toBe('Video 2');
    expect(state.tracks.find(t => t.id === audioId)!.name).toBe('Audio 2');
  });

  it('addTrack auto-names increment correctly for multiple pre-existing tracks', () => {
    // Use pre-configured tracks to avoid Date.now() ID collisions
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video' }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video' }),
        createMockTrack({ id: 'v3', name: 'Video 3', type: 'video' }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
        createMockTrack({ id: 'a2', name: 'Audio 2', type: 'audio', height: 40 }),
      ],
    } as any);

    // Adding another video track should be "Video 4" (3 existing + 1)
    const newVideo = store.getState().addTrack('video');
    expect(store.getState().tracks.find(t => t.id === newVideo)!.name).toBe('Video 4');

    // Adding another audio track should be "Audio 3" (2 existing + 1)
    const newAudio = store.getState().addTrack('audio');
    expect(store.getState().tracks.find(t => t.id === newAudio)!.name).toBe('Audio 3');
  });

  it('addTrack: returns the new track id', () => {
    const id = store.getState().addTrack('video');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // The id should start with the type prefix
    expect(id.startsWith('video-')).toBe(true);
  });

  it('addTrack(audio): returned id starts with audio-', () => {
    const id = store.getState().addTrack('audio');
    expect(id.startsWith('audio-')).toBe(true);
  });

  it('addTrack: auto-expands the new track in expandedTracks', () => {
    const id = store.getState().addTrack('video');
    const state = store.getState();
    expect(state.expandedTracks.has(id)).toBe(true);
  });

  it('addTrack: preserves existing expandedTracks when adding', () => {
    // Initially video-1 and audio-1 are expanded
    const initialExpanded = new Set(store.getState().expandedTracks);
    store.getState().addTrack('video');
    const state = store.getState();
    // All previously expanded tracks should still be expanded
    for (const trackId of initialExpanded) {
      expect(state.expandedTracks.has(trackId)).toBe(true);
    }
  });

  it('addTrack: video and audio maintain correct ordering (video before audio)', () => {
    // Add several tracks of each type
    store.getState().addTrack('video');
    store.getState().addTrack('audio');
    store.getState().addTrack('video');
    store.getState().addTrack('audio');
    const state = store.getState();

    // All video tracks should come before all audio tracks
    const firstAudioIndex = state.tracks.findIndex(t => t.type === 'audio');
    const lastVideoIndex = state.tracks.length - 1 - [...state.tracks].reverse().findIndex(t => t.type === 'video');
    expect(lastVideoIndex).toBeLessThan(firstAudioIndex);
  });

  it('addTrack increases total track count', () => {
    const initialCount = store.getState().tracks.length;
    store.getState().addTrack('video');
    expect(store.getState().tracks.length).toBe(initialCount + 1);
    store.getState().addTrack('audio');
    expect(store.getState().tracks.length).toBe(initialCount + 2);
  });

  // ──────────────────────────────────────────────────
  // removeTrack
  // ──────────────────────────────────────────────────

  it('removeTrack: removes track and associated clips', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    store = createTestTimelineStore({ clips: [clip] } as any);

    store.getState().removeTrack('video-1');
    const state = store.getState();
    expect(state.tracks.find(t => t.id === 'video-1')).toBeUndefined();
    expect(state.clips.find(c => c.trackId === 'video-1')).toBeUndefined();
  });

  it('removeTrack: removes multiple clips on the same track', () => {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0 });
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 5 });
    const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1', startTime: 10 });
    store = createTestTimelineStore({ clips: [clip1, clip2, clip3] } as any);

    store.getState().removeTrack('video-1');
    const state = store.getState();
    expect(state.clips.length).toBe(0);
  });

  it('removeTrack: does not affect clips on other tracks', () => {
    const clipOnVideo = createMockClip({ id: 'clip-v', trackId: 'video-1' });
    const clipOnAudio = createMockClip({ id: 'clip-a', trackId: 'audio-1' });
    store = createTestTimelineStore({ clips: [clipOnVideo, clipOnAudio] } as any);

    store.getState().removeTrack('video-1');
    const state = store.getState();
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].id).toBe('clip-a');
  });

  it('removeTrack: non-existent track is a no-op (no crash)', () => {
    const initialTrackCount = store.getState().tracks.length;
    store.getState().removeTrack('non-existent-track');
    expect(store.getState().tracks.length).toBe(initialTrackCount);
  });

  it('removeTrack: decreases track count', () => {
    const initialCount = store.getState().tracks.length;
    store.getState().removeTrack('video-1');
    expect(store.getState().tracks.length).toBe(initialCount - 1);
  });

  // ──────────────────────────────────────────────────
  // renameTrack
  // ──────────────────────────────────────────────────

  it('renameTrack: updates track name', () => {
    store.getState().renameTrack('video-1', 'Main Video');
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.name).toBe('Main Video');
  });

  it('renameTrack: can set empty string name', () => {
    store.getState().renameTrack('video-1', '');
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.name).toBe('');
  });

  it('renameTrack: does not affect other tracks', () => {
    const originalAudioName = store.getState().tracks.find(t => t.id === 'audio-1')!.name;
    store.getState().renameTrack('video-1', 'Renamed');
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.name).toBe(originalAudioName);
  });

  it('renameTrack: non-existent track is a no-op', () => {
    const tracksBefore = store.getState().tracks.map(t => ({ ...t }));
    store.getState().renameTrack('non-existent', 'Something');
    const tracksAfter = store.getState().tracks;
    // Track names should be unchanged
    expect(tracksAfter.map(t => t.name)).toEqual(tracksBefore.map(t => t.name));
  });

  // ──────────────────────────────────────────────────
  // setTrackMuted
  // ──────────────────────────────────────────────────

  it('setTrackMuted: toggles muted flag', () => {
    store.getState().setTrackMuted('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.muted).toBe(true);
    store.getState().setTrackMuted('video-1', false);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.muted).toBe(false);
  });

  it('setTrackMuted: does not affect other tracks', () => {
    store.getState().setTrackMuted('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.muted).toBe(false);
  });

  // ──────────────────────────────────────────────────
  // setTrackVisible
  // ──────────────────────────────────────────────────

  it('setTrackVisible: toggles visible flag', () => {
    store.getState().setTrackVisible('video-1', false);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.visible).toBe(false);
  });

  it('setTrackVisible: can toggle back to true', () => {
    store.getState().setTrackVisible('video-1', false);
    store.getState().setTrackVisible('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.visible).toBe(true);
  });

  it('setTrackVisible: calls invalidateCache for video tracks', () => {
    const invalidateSpy = vi.fn();
    store = createTestTimelineStore({ invalidateCache: invalidateSpy } as any);
    store.getState().setTrackVisible('video-1', false);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('setTrackVisible: does not call invalidateCache for audio tracks', () => {
    const invalidateSpy = vi.fn();
    store = createTestTimelineStore({ invalidateCache: invalidateSpy } as any);
    store.getState().setTrackVisible('audio-1', false);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────
  // setTrackSolo
  // ──────────────────────────────────────────────────

  it('setTrackSolo: toggles solo flag', () => {
    store.getState().setTrackSolo('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.solo).toBe(true);
  });

  it('setTrackSolo: can toggle back to false', () => {
    store.getState().setTrackSolo('video-1', true);
    store.getState().setTrackSolo('video-1', false);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.solo).toBe(false);
  });

  it('setTrackSolo: multiple tracks can be solo at the same time', () => {
    // Use pre-configured tracks to avoid Date.now() ID collisions
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video' }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video' }),
      ],
    } as any);
    store.getState().setTrackSolo('v1', true);
    store.getState().setTrackSolo('v2', true);
    expect(store.getState().tracks.find(t => t.id === 'v1')!.solo).toBe(true);
    expect(store.getState().tracks.find(t => t.id === 'v2')!.solo).toBe(true);
  });

  it('setTrackSolo: calls invalidateCache for video tracks', () => {
    const invalidateSpy = vi.fn();
    store = createTestTimelineStore({ invalidateCache: invalidateSpy } as any);
    store.getState().setTrackSolo('video-1', true);
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('setTrackSolo: does not call invalidateCache for audio tracks', () => {
    const invalidateSpy = vi.fn();
    store = createTestTimelineStore({ invalidateCache: invalidateSpy } as any);
    store.getState().setTrackSolo('audio-1', true);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────
  // setTrackHeight
  // ──────────────────────────────────────────────────

  it('setTrackHeight: clamps to min/max', () => {
    store.getState().setTrackHeight('video-1', 5); // below min
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(20); // MIN_TRACK_HEIGHT

    store.getState().setTrackHeight('video-1', 500); // above max
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(200); // MAX_TRACK_HEIGHT
  });

  it('setTrackHeight: sets valid height within range', () => {
    store.getState().setTrackHeight('video-1', 100);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(100);
  });

  it('setTrackHeight: accepts exact MIN boundary (20)', () => {
    store.getState().setTrackHeight('video-1', 20);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(20);
  });

  it('setTrackHeight: accepts exact MAX boundary (200)', () => {
    store.getState().setTrackHeight('video-1', 200);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(200);
  });

  it('setTrackHeight: clamps zero to MIN', () => {
    store.getState().setTrackHeight('video-1', 0);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(20);
  });

  it('setTrackHeight: clamps negative values to MIN', () => {
    store.getState().setTrackHeight('video-1', -50);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(20);
  });

  it('setTrackHeight: does not affect other tracks', () => {
    const originalAudioHeight = store.getState().tracks.find(t => t.id === 'audio-1')!.height;
    store.getState().setTrackHeight('video-1', 150);
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.height).toBe(originalAudioHeight);
  });

  // ──────────────────────────────────────────────────
  // scaleTracksOfType
  // ──────────────────────────────────────────────────

  it('scaleTracksOfType: scales all video tracks uniformly with positive delta', () => {
    // Use pre-configured tracks so both video tracks have known heights
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 60 }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video', height: 60 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);
    store.getState().scaleTracksOfType('video', 20);
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(80); // 60 + 20
    }
  });

  it('scaleTracksOfType: scales all video tracks uniformly with negative delta', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 60 }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video', height: 60 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);
    store.getState().scaleTracksOfType('video', -20);
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(40); // 60 - 20
    }
  });

  it('scaleTracksOfType: clamps to MIN_TRACK_HEIGHT (20)', () => {
    store.getState().scaleTracksOfType('video', -100); // 60 - 100 = -40 => clamped to 20
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(20);
    }
  });

  it('scaleTracksOfType: clamps to MAX_TRACK_HEIGHT (200)', () => {
    store.getState().scaleTracksOfType('video', 300); // 60 + 300 = 360 => clamped to 200
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(200);
    }
  });

  it('scaleTracksOfType: syncs to max height first when tracks differ', () => {
    // Use pre-configured tracks with different heights
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 80 }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video', height: 40 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);

    // First call with non-zero delta should sync all to max (80)
    store.getState().scaleTracksOfType('video', 10);
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(80); // Synced to max first, not scaled yet
    }
  });

  it('scaleTracksOfType: after syncing, subsequent call scales uniformly', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 80 }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video', height: 40 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);

    // First call syncs to max (80)
    store.getState().scaleTracksOfType('video', 10);
    // Second call should now scale uniformly (80 + 10 = 90)
    store.getState().scaleTracksOfType('video', 10);
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(90);
    }
  });

  it('scaleTracksOfType: does nothing when no tracks of given type exist', () => {
    // Remove all audio tracks
    store.getState().removeTrack('audio-1');
    const tracksBefore = store.getState().tracks.map(t => ({ ...t }));
    store.getState().scaleTracksOfType('audio', 20);
    const tracksAfter = store.getState().tracks;
    // Nothing should have changed
    expect(tracksAfter.length).toBe(tracksBefore.length);
    for (let i = 0; i < tracksAfter.length; i++) {
      expect(tracksAfter[i].height).toBe(tracksBefore[i].height);
    }
  });

  it('scaleTracksOfType: only affects tracks of the specified type', () => {
    const originalAudioHeight = store.getState().tracks.find(t => t.id === 'audio-1')!.height;
    store.getState().scaleTracksOfType('video', 30);
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.height).toBe(originalAudioHeight);
  });

  it('scaleTracksOfType: works for audio tracks', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 60 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
        createMockTrack({ id: 'a2', name: 'Audio 2', type: 'audio', height: 40 }),
      ],
    } as any);
    store.getState().scaleTracksOfType('audio', 15);
    const audioTracks = store.getState().tracks.filter(t => t.type === 'audio');
    for (const t of audioTracks) {
      expect(t.height).toBe(55); // 40 + 15
    }
  });

  it('scaleTracksOfType: delta 0 with different heights syncs to max', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'v1', name: 'Video 1', type: 'video', height: 100 }),
        createMockTrack({ id: 'v2', name: 'Video 2', type: 'video', height: 50 }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);

    // delta=0 but tracks differ: code goes to else branch (since delta === 0, !allSameHeight && delta !== 0 is false)
    // So it scales uniformly: newHeight = max(100) + 0 = 100
    store.getState().scaleTracksOfType('video', 0);
    const videoTracks = store.getState().tracks.filter(t => t.type === 'video');
    for (const t of videoTracks) {
      expect(t.height).toBe(100); // max + 0 = 100
    }
  });

  // ──────────────────────────────────────────────────
  // setTrackParent
  // ──────────────────────────────────────────────────

  it('setTrackParent: prevents self-parenting', () => {
    store.getState().setTrackParent('video-1', 'video-1');
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.parentTrackId).toBeUndefined();
  });

  it('setTrackParent: sets parent for valid case', () => {
    const newId = store.getState().addTrack('video');
    store.getState().setTrackParent(newId, 'video-1');
    expect(store.getState().tracks.find(t => t.id === newId)!.parentTrackId).toBe('video-1');
  });

  it('setTrackParent(null): clears parent', () => {
    const newId = store.getState().addTrack('video');
    store.getState().setTrackParent(newId, 'video-1');
    store.getState().setTrackParent(newId, null);
    expect(store.getState().tracks.find(t => t.id === newId)!.parentTrackId).toBeUndefined();
  });

  it('setTrackParent: prevents direct cycle (A->B, then B->A)', () => {
    // Use pre-configured tracks to avoid Date.now() ID collisions
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'trackA', name: 'Track A', type: 'video' }),
        createMockTrack({ id: 'trackB', name: 'Track B', type: 'video' }),
      ],
    } as any);
    // A is child of B
    store.getState().setTrackParent('trackA', 'trackB');
    expect(store.getState().tracks.find(t => t.id === 'trackA')!.parentTrackId).toBe('trackB');
    // Now B tries to become child of A - would create cycle
    store.getState().setTrackParent('trackB', 'trackA');
    expect(store.getState().tracks.find(t => t.id === 'trackB')!.parentTrackId).toBeUndefined();
  });

  it('setTrackParent: prevents indirect cycle (A->B->C, then C->A)', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'trackA', name: 'Track A', type: 'video' }),
        createMockTrack({ id: 'trackB', name: 'Track B', type: 'video' }),
        createMockTrack({ id: 'trackC', name: 'Track C', type: 'video' }),
      ],
    } as any);
    // Build chain: A -> B -> C
    store.getState().setTrackParent('trackA', 'trackB');
    store.getState().setTrackParent('trackB', 'trackC');
    // Now C tries to become child of A - would create cycle A->B->C->A
    store.getState().setTrackParent('trackC', 'trackA');
    expect(store.getState().tracks.find(t => t.id === 'trackC')!.parentTrackId).toBeUndefined();
  });

  it('setTrackParent: allows changing parent from one track to another', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'child', name: 'Child', type: 'video' }),
        createMockTrack({ id: 'parent1', name: 'Parent 1', type: 'video' }),
        createMockTrack({ id: 'parent2', name: 'Parent 2', type: 'video' }),
      ],
    } as any);
    store.getState().setTrackParent('child', 'parent1');
    expect(store.getState().tracks.find(t => t.id === 'child')!.parentTrackId).toBe('parent1');
    store.getState().setTrackParent('child', 'parent2');
    expect(store.getState().tracks.find(t => t.id === 'child')!.parentTrackId).toBe('parent2');
  });

  it('setTrackParent: allows valid chain without cycles (A->B->C)', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'trackA', name: 'Track A', type: 'video' }),
        createMockTrack({ id: 'trackB', name: 'Track B', type: 'video' }),
        createMockTrack({ id: 'trackC', name: 'Track C', type: 'video' }),
      ],
    } as any);
    store.getState().setTrackParent('trackA', 'trackB');
    store.getState().setTrackParent('trackB', 'trackC');
    expect(store.getState().tracks.find(t => t.id === 'trackA')!.parentTrackId).toBe('trackB');
    expect(store.getState().tracks.find(t => t.id === 'trackB')!.parentTrackId).toBe('trackC');
    expect(store.getState().tracks.find(t => t.id === 'trackC')!.parentTrackId).toBeUndefined();
  });

  // ──────────────────────────────────────────────────
  // getTrackChildren
  // ──────────────────────────────────────────────────

  it('getTrackChildren: returns child tracks', () => {
    const childId = store.getState().addTrack('video');
    store.getState().setTrackParent(childId, 'video-1');
    const children = store.getState().getTrackChildren('video-1');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(childId);
  });

  it('getTrackChildren: returns empty array when no children', () => {
    const children = store.getState().getTrackChildren('video-1');
    expect(children).toEqual([]);
  });

  it('getTrackChildren: returns multiple children', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'parent', name: 'Parent', type: 'video' }),
        createMockTrack({ id: 'child1', name: 'Child 1', type: 'video', parentTrackId: 'parent' }),
        createMockTrack({ id: 'child2', name: 'Child 2', type: 'video', parentTrackId: 'parent' }),
        createMockTrack({ id: 'child3', name: 'Child 3', type: 'video', parentTrackId: 'parent' }),
      ],
    } as any);
    const children = store.getState().getTrackChildren('parent');
    expect(children.length).toBe(3);
    const childIds = children.map(c => c.id);
    expect(childIds).toContain('child1');
    expect(childIds).toContain('child2');
    expect(childIds).toContain('child3');
  });

  it('getTrackChildren: does not return grandchildren (only direct children)', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'grandparent', name: 'Grandparent', type: 'video' }),
        createMockTrack({ id: 'child', name: 'Child', type: 'video', parentTrackId: 'grandparent' }),
        createMockTrack({ id: 'grandchild', name: 'Grandchild', type: 'video', parentTrackId: 'child' }),
      ],
    } as any);
    const children = store.getState().getTrackChildren('grandparent');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe('child');
  });

  it('getTrackChildren: returns empty for non-existent track', () => {
    const children = store.getState().getTrackChildren('non-existent');
    expect(children).toEqual([]);
  });

  // ──────────────────────────────────────────────────
  // Combined / Integration scenarios
  // ──────────────────────────────────────────────────

  it('removeTrack after addTrack: removes newly added track', () => {
    const newId = store.getState().addTrack('video');
    const countBefore = store.getState().tracks.length;
    store.getState().removeTrack(newId);
    expect(store.getState().tracks.length).toBe(countBefore - 1);
    expect(store.getState().tracks.find(t => t.id === newId)).toBeUndefined();
  });

  it('renameTrack after addTrack: renames newly added track', () => {
    const newId = store.getState().addTrack('audio');
    store.getState().renameTrack(newId, 'Music');
    expect(store.getState().tracks.find(t => t.id === newId)!.name).toBe('Music');
  });

  it('setTrackHeight on audio track: clamps the same way', () => {
    store.getState().setTrackHeight('audio-1', 5);
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.height).toBe(20);
    store.getState().setTrackHeight('audio-1', 999);
    expect(store.getState().tracks.find(t => t.id === 'audio-1')!.height).toBe(200);
  });

  it('removing parent track leaves orphan children unchanged', () => {
    store = createTestTimelineStore({
      tracks: [
        createMockTrack({ id: 'parent', name: 'Parent', type: 'video' }),
        createMockTrack({ id: 'child', name: 'Child', type: 'video', parentTrackId: 'parent' }),
        createMockTrack({ id: 'a1', name: 'Audio 1', type: 'audio', height: 40 }),
      ],
    } as any);
    store.getState().removeTrack('parent');
    // The child still has parentTrackId pointing to removed track
    // (it becomes an orphan - this is the current behavior)
    const childTrack = store.getState().tracks.find(t => t.id === 'child');
    expect(childTrack).toBeDefined();
    expect(childTrack!.parentTrackId).toBe('parent');
  });

  it('removing all tracks of one type preserves other type', () => {
    store.getState().removeTrack('video-1');
    const state = store.getState();
    expect(state.tracks.filter(t => t.type === 'video').length).toBe(0);
    expect(state.tracks.filter(t => t.type === 'audio').length).toBe(1);
  });

  it('setTrackMuted on newly added track works', () => {
    const newId = store.getState().addTrack('video');
    store.getState().setTrackMuted(newId, true);
    expect(store.getState().tracks.find(t => t.id === newId)!.muted).toBe(true);
  });

  it('setTrackVisible on newly added track works', () => {
    const newId = store.getState().addTrack('audio');
    store.getState().setTrackVisible(newId, false);
    expect(store.getState().tracks.find(t => t.id === newId)!.visible).toBe(false);
  });
});
