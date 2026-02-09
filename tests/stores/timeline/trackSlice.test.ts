import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

describe('trackSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

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

  it('removeTrack: removes track and associated clips', () => {
    const clip = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    store = createTestTimelineStore({ clips: [clip] } as any);

    store.getState().removeTrack('video-1');
    const state = store.getState();
    expect(state.tracks.find(t => t.id === 'video-1')).toBeUndefined();
    expect(state.clips.find(c => c.trackId === 'video-1')).toBeUndefined();
  });

  it('renameTrack: updates track name', () => {
    store.getState().renameTrack('video-1', 'Main Video');
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.name).toBe('Main Video');
  });

  it('setTrackMuted: toggles muted flag', () => {
    store.getState().setTrackMuted('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.muted).toBe(true);
    store.getState().setTrackMuted('video-1', false);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.muted).toBe(false);
  });

  it('setTrackVisible: toggles visible flag', () => {
    store.getState().setTrackVisible('video-1', false);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.visible).toBe(false);
  });

  it('setTrackSolo: toggles solo flag', () => {
    store.getState().setTrackSolo('video-1', true);
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.solo).toBe(true);
  });

  it('setTrackHeight: clamps to min/max', () => {
    store.getState().setTrackHeight('video-1', 5); // below min
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(20); // MIN_TRACK_HEIGHT

    store.getState().setTrackHeight('video-1', 500); // above max
    expect(store.getState().tracks.find(t => t.id === 'video-1')!.height).toBe(200); // MAX_TRACK_HEIGHT
  });

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

  it('getTrackChildren: returns child tracks', () => {
    const childId = store.getState().addTrack('video');
    store.getState().setTrackParent(childId, 'video-1');
    const children = store.getState().getTrackChildren('video-1');
    expect(children.length).toBe(1);
    expect(children[0].id).toBe(childId);
  });
});
