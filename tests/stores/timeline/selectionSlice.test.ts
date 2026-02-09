import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockKeyframe } from '../../helpers/mockData';
import type { Keyframe } from '../../../src/types';

describe('selectionSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 5 });
    const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1', startTime: 10, linkedClipId: 'clip-4' });
    const clip4 = createMockClip({ id: 'clip-4', trackId: 'audio-1', startTime: 10 });
    store = createTestTimelineStore({ clips: [clip1, clip2, clip3, clip4] } as any);
  });

  it('selectClip: selects a clip and sets primarySelectedClipId', () => {
    store.getState().selectClip('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  it('selectClip: normal click also selects linked clip', () => {
    store.getState().selectClip('clip-3');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-3')).toBe(true);
    expect(state.selectedClipIds.has('clip-4')).toBe(true);
    expect(state.selectedClipIds.size).toBe(2);
  });

  it('selectClip(null): clears selection', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClip(null);
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  it('selectClip with addToSelection: toggles individual clip', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClip('clip-2', true);
    let state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
    expect(state.selectedClipIds.size).toBe(2);

    // Toggle off clip-1
    store.getState().selectClip('clip-1', true);
    state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(false);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('selectClips: selects multiple clips', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(2);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  it('addClipToSelection: adds without removing existing', () => {
    store.getState().selectClip('clip-1');
    store.getState().addClipToSelection('clip-2');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
    expect(state.primarySelectedClipId).toBe('clip-2');
  });

  it('removeClipFromSelection: removes single clip', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    store.getState().removeClipFromSelection('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(false);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('clearClipSelection: empties all', () => {
    store.getState().selectClips(['clip-1', 'clip-2', 'clip-3']);
    store.getState().clearClipSelection();
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  // ─── Keyframe selection ────────────────────────────────────────────────

  it('selectKeyframe: selects a single keyframe', () => {
    store.getState().selectKeyframe('kf-1');
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(true);
  });

  it('selectKeyframe with addToSelection: toggles', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2', true);
    expect(store.getState().selectedKeyframeIds.size).toBe(2);

    store.getState().selectKeyframe('kf-1', true);
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(false);
    expect(store.getState().selectedKeyframeIds.has('kf-2')).toBe(true);
  });

  it('deselectAllKeyframes: clears all', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2', true);
    store.getState().deselectAllKeyframes();
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  it('deleteSelectedKeyframes: removes from clipKeyframes map', () => {
    const kf1 = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 });
    const kf2 = createMockKeyframe({ id: 'kf-2', clipId: 'clip-1', property: 'opacity', time: 1, value: 1 });
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', [kf1, kf2]);

    store = createTestTimelineStore({
      clips: [createMockClip({ id: 'clip-1' })],
      clipKeyframes: keyframeMap,
      selectedKeyframeIds: new Set(['kf-1']),
    } as any);

    store.getState().deleteSelectedKeyframes();
    const state = store.getState();
    expect(state.clipKeyframes.get('clip-1')?.length).toBe(1);
    expect(state.clipKeyframes.get('clip-1')?.[0].id).toBe('kf-2');
    expect(state.selectedKeyframeIds.size).toBe(0);
  });
});
