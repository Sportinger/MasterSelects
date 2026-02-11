import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockKeyframe } from '../../helpers/mockData';
import type { Keyframe, AnimatableProperty } from '../../../src/types';

describe('selectionSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 5 });
    const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1', startTime: 10, linkedClipId: 'clip-4' });
    const clip4 = createMockClip({ id: 'clip-4', trackId: 'audio-1', startTime: 10 });
    store = createTestTimelineStore({ clips: [clip1, clip2, clip3, clip4] } as any);
  });

  // ─── Helper to create a store with curve editor open on a track ──────
  function createStoreWithCurveEditor(trackId: string = 'video-1') {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 5 });
    const clip3 = createMockClip({ id: 'clip-3', trackId: 'video-1', startTime: 10, linkedClipId: 'clip-4' });
    const clip4 = createMockClip({ id: 'clip-4', trackId: 'audio-1', startTime: 10 });
    const curveProps = new Map<string, Set<AnimatableProperty>>();
    curveProps.set(trackId, new Set(['opacity' as AnimatableProperty]));
    return createTestTimelineStore({
      clips: [clip1, clip2, clip3, clip4],
      expandedCurveProperties: curveProps,
      selectedClipIds: new Set(['clip-1']),
      primarySelectedClipId: 'clip-1',
    } as any);
  }

  // ─── selectClip: basic ───────────────────────────────────────────────

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

  it('selectClip: normal click replaces previous selection', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClip('clip-2');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(false);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.primarySelectedClipId).toBe('clip-2');
  });

  it('selectClip: normal click on unlinked clip selects only that clip', () => {
    store.getState().selectClip('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('selectClip: linked clip sets primarySelectedClipId to clicked clip', () => {
    store.getState().selectClip('clip-3');
    expect(store.getState().primarySelectedClipId).toBe('clip-3');

    // Click the other side of the linked pair
    store.getState().selectClip('clip-4');
    // clip-4 has no linkedClipId in its own data, so only clip-4 is selected
    expect(store.getState().primarySelectedClipId).toBe('clip-4');
  });

  // ─── selectClip: setPrimaryOnly ──────────────────────────────────────

  it('selectClip with setPrimaryOnly: updates primary without changing selection', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    expect(store.getState().primarySelectedClipId).toBe('clip-1');

    store.getState().selectClip('clip-2', false, true);
    const state = store.getState();
    expect(state.primarySelectedClipId).toBe('clip-2');
    // Selection set should remain unchanged
    expect(state.selectedClipIds.size).toBe(2);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('selectClip with setPrimaryOnly and null id: does not change primary', () => {
    store.getState().selectClip('clip-1');
    // setPrimaryOnly with null id should hit the null branch, not the setPrimaryOnly branch
    store.getState().selectClip(null, false, true);
    const state = store.getState();
    // null id goes through the normal clear path (setPrimaryOnly requires id !== null)
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  // ─── selectClip: addToSelection with linked clips ────────────────────

  it('selectClip with addToSelection: does not auto-select linked clip', () => {
    // Shift+click should toggle only the clicked clip, not its linked pair
    store.getState().selectClip('clip-3', true);
    const state = store.getState();
    // addToSelection toggles just the clicked clip independently
    expect(state.selectedClipIds.has('clip-3')).toBe(true);
    // clip-4 should NOT be auto-added in addToSelection mode
    // Actually, looking at the source: addToSelection only toggles the single id
    expect(state.selectedClipIds.size).toBe(1);
  });

  it('selectClip with addToSelection: sets primary to the toggled-on clip', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClip('clip-2', true);
    expect(store.getState().primarySelectedClipId).toBe('clip-2');
  });

  it('selectClip with addToSelection: sets primary even when toggling off', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClip('clip-2', true);
    // Toggle off clip-2
    store.getState().selectClip('clip-2', true);
    // primary is set to the toggled id regardless
    expect(store.getState().primarySelectedClipId).toBe('clip-2');
  });

  // ─── selectClips ─────────────────────────────────────────────────────

  it('selectClips: selects multiple clips', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(2);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  it('selectClips: empty array clears selection', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectClips([]);
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  it('selectClips: replaces previous selection entirely', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    store.getState().selectClips(['clip-3']);
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-3')).toBe(true);
    expect(state.selectedClipIds.has('clip-1')).toBe(false);
    expect(state.primarySelectedClipId).toBe('clip-3');
  });

  it('selectClips: primary is first id in the array', () => {
    store.getState().selectClips(['clip-2', 'clip-1', 'clip-3']);
    expect(store.getState().primarySelectedClipId).toBe('clip-2');
  });

  // ─── addClipToSelection ──────────────────────────────────────────────

  it('addClipToSelection: adds without removing existing', () => {
    store.getState().selectClip('clip-1');
    store.getState().addClipToSelection('clip-2');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
    expect(state.primarySelectedClipId).toBe('clip-2');
  });

  it('addClipToSelection: adding already-selected clip is idempotent but updates primary', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    expect(store.getState().primarySelectedClipId).toBe('clip-1');

    store.getState().addClipToSelection('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(2);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  it('addClipToSelection: works from empty selection', () => {
    store.getState().addClipToSelection('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  // ─── removeClipFromSelection ─────────────────────────────────────────

  it('removeClipFromSelection: removes single clip', () => {
    store.getState().selectClips(['clip-1', 'clip-2']);
    store.getState().removeClipFromSelection('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(false);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('removeClipFromSelection: removing non-selected clip is a no-op', () => {
    store.getState().selectClip('clip-1');
    store.getState().removeClipFromSelection('clip-2');
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('removeClipFromSelection: removing last clip leaves empty set', () => {
    store.getState().selectClip('clip-1');
    store.getState().removeClipFromSelection('clip-1');
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
  });

  // ─── clearClipSelection ──────────────────────────────────────────────

  it('clearClipSelection: empties all', () => {
    store.getState().selectClips(['clip-1', 'clip-2', 'clip-3']);
    store.getState().clearClipSelection();
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  it('clearClipSelection: is safe when already empty', () => {
    store.getState().clearClipSelection();
    const state = store.getState();
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  // ─── Curve editor blocking behavior ──────────────────────────────────

  it('selectClip(null): blocked when curve editor is open on selected clip', () => {
    const s = createStoreWithCurveEditor('video-1');
    // clip-1 is selected and is on video-1 which has curve editor open
    s.getState().selectClip(null);
    const state = s.getState();
    // Selection should NOT be cleared
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('selectClip: normal click on different clip blocked when curve editor is open', () => {
    const s = createStoreWithCurveEditor('video-1');
    // clip-1 is selected, curve editor open on video-1
    // Clicking clip-2 (not currently selected) should be blocked
    s.getState().selectClip('clip-2');
    const state = s.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(false);
  });

  it('selectClip: normal click on already-selected clip allowed when curve editor is open', () => {
    const s = createStoreWithCurveEditor('video-1');
    // Clicking clip-1 (already selected) should NOT be blocked
    s.getState().selectClip('clip-1');
    const state = s.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.primarySelectedClipId).toBe('clip-1');
  });

  it('selectClip with addToSelection: toggle off blocked when clip has curve editor open', () => {
    const s = createStoreWithCurveEditor('video-1');
    // clip-1 is selected and has curve editor open on its track
    // Trying to toggle it off should be blocked
    s.getState().selectClip('clip-1', true);
    const state = s.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('selectClip with addToSelection: toggle on allowed when curve editor is open', () => {
    const s = createStoreWithCurveEditor('video-1');
    // Adding clip-2 via shift+click should work (it is adding, not removing)
    s.getState().selectClip('clip-2', true);
    const state = s.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('selectClips: blocked when would deselect clip with curve editor open', () => {
    const s = createStoreWithCurveEditor('video-1');
    // clip-1 is selected, try to replace selection with clip-2 only
    s.getState().selectClips(['clip-2']);
    const state = s.getState();
    // Should be blocked because clip-1 would be deselected
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(false);
  });

  it('selectClips: allowed when all currently selected clips remain in new selection', () => {
    const s = createStoreWithCurveEditor('video-1');
    // clip-1 is selected, select clip-1 AND clip-2 (clip-1 stays)
    s.getState().selectClips(['clip-1', 'clip-2']);
    const state = s.getState();
    expect(state.selectedClipIds.size).toBe(2);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedClipIds.has('clip-2')).toBe(true);
  });

  it('removeClipFromSelection: blocked when clip has curve editor open', () => {
    const s = createStoreWithCurveEditor('video-1');
    s.getState().removeClipFromSelection('clip-1');
    const state = s.getState();
    // Should be blocked
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('removeClipFromSelection: allowed for clip on track without curve editor', () => {
    // Open curve editor on video-1 but select clips on both tracks
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const clip4 = createMockClip({ id: 'clip-4', trackId: 'audio-1', startTime: 10 });
    const curveProps = new Map<string, Set<AnimatableProperty>>();
    curveProps.set('video-1', new Set(['opacity' as AnimatableProperty]));
    const s = createTestTimelineStore({
      clips: [clip1, clip4],
      expandedCurveProperties: curveProps,
      selectedClipIds: new Set(['clip-1', 'clip-4']),
      primarySelectedClipId: 'clip-1',
    } as any);

    // Removing clip-4 (on audio-1, no curve editor) should work
    s.getState().removeClipFromSelection('clip-4');
    const state = s.getState();
    expect(state.selectedClipIds.has('clip-4')).toBe(false);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('clearClipSelection: blocked when curve editor is open on selected clip', () => {
    const s = createStoreWithCurveEditor('video-1');
    s.getState().clearClipSelection();
    const state = s.getState();
    // Should be blocked
    expect(state.selectedClipIds.size).toBe(1);
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
  });

  it('clearClipSelection: allowed when curve editor is on a track with no selected clips', () => {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const clip4 = createMockClip({ id: 'clip-4', trackId: 'audio-1', startTime: 10 });
    const curveProps = new Map<string, Set<AnimatableProperty>>();
    // Curve editor on audio-1
    curveProps.set('audio-1', new Set(['opacity' as AnimatableProperty]));
    const s = createTestTimelineStore({
      clips: [clip1, clip4],
      expandedCurveProperties: curveProps,
      // Only clip-1 (on video-1) is selected, curve editor is on audio-1
      selectedClipIds: new Set(['clip-1']),
      primarySelectedClipId: 'clip-1',
    } as any);

    s.getState().clearClipSelection();
    const state = s.getState();
    // Should be allowed since no selected clip is on the track with the curve editor
    expect(state.selectedClipIds.size).toBe(0);
    expect(state.primarySelectedClipId).toBeNull();
  });

  it('curve editor: no blocking when expandedCurveProperties is empty', () => {
    // Default store has no curve properties - all operations should work normally
    store.getState().selectClip('clip-1');
    store.getState().selectClip(null);
    expect(store.getState().selectedClipIds.size).toBe(0);

    store.getState().selectClips(['clip-1', 'clip-2']);
    store.getState().selectClips(['clip-3']);
    expect(store.getState().selectedClipIds.has('clip-3')).toBe(true);
  });

  it('curve editor: empty set in expandedCurveProperties does not block', () => {
    const clip1 = createMockClip({ id: 'clip-1', trackId: 'video-1' });
    const curveProps = new Map<string, Set<AnimatableProperty>>();
    // Track has entry but empty set of properties
    curveProps.set('video-1', new Set());
    const s = createTestTimelineStore({
      clips: [clip1],
      expandedCurveProperties: curveProps,
      selectedClipIds: new Set(['clip-1']),
      primarySelectedClipId: 'clip-1',
    } as any);

    s.getState().selectClip(null);
    expect(s.getState().selectedClipIds.size).toBe(0);
  });

  // ─── Keyframe selection ────────────────────────────────────────────────

  it('selectKeyframe: selects a single keyframe', () => {
    store.getState().selectKeyframe('kf-1');
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(true);
  });

  it('selectKeyframe: replaces previous selection when addToSelection is false', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2');
    const state = store.getState();
    expect(state.selectedKeyframeIds.size).toBe(1);
    expect(state.selectedKeyframeIds.has('kf-1')).toBe(false);
    expect(state.selectedKeyframeIds.has('kf-2')).toBe(true);
  });

  it('selectKeyframe with addToSelection: toggles', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2', true);
    expect(store.getState().selectedKeyframeIds.size).toBe(2);

    store.getState().selectKeyframe('kf-1', true);
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(false);
    expect(store.getState().selectedKeyframeIds.has('kf-2')).toBe(true);
  });

  it('selectKeyframe with addToSelection: can build up multi-selection', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2', true);
    store.getState().selectKeyframe('kf-3', true);
    expect(store.getState().selectedKeyframeIds.size).toBe(3);
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(true);
    expect(store.getState().selectedKeyframeIds.has('kf-2')).toBe(true);
    expect(store.getState().selectedKeyframeIds.has('kf-3')).toBe(true);
  });

  it('deselectAllKeyframes: clears all', () => {
    store.getState().selectKeyframe('kf-1');
    store.getState().selectKeyframe('kf-2', true);
    store.getState().deselectAllKeyframes();
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  it('deselectAllKeyframes: safe when already empty', () => {
    store.getState().deselectAllKeyframes();
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  // ─── deleteSelectedKeyframes ─────────────────────────────────────────

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

  it('deleteSelectedKeyframes: no-op when no keyframes selected', () => {
    const kf1 = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 });
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', [kf1]);

    store = createTestTimelineStore({
      clips: [createMockClip({ id: 'clip-1' })],
      clipKeyframes: keyframeMap,
      selectedKeyframeIds: new Set(),
    } as any);

    store.getState().deleteSelectedKeyframes();
    const state = store.getState();
    expect(state.clipKeyframes.get('clip-1')?.length).toBe(1);
  });

  it('deleteSelectedKeyframes: removes clip entry when all keyframes deleted', () => {
    const kf1 = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 });
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', [kf1]);

    store = createTestTimelineStore({
      clips: [createMockClip({ id: 'clip-1' })],
      clipKeyframes: keyframeMap,
      selectedKeyframeIds: new Set(['kf-1']),
    } as any);

    store.getState().deleteSelectedKeyframes();
    const state = store.getState();
    // When all keyframes for a clip are deleted, the entry is removed from the map
    expect(state.clipKeyframes.has('clip-1')).toBe(false);
    expect(state.selectedKeyframeIds.size).toBe(0);
  });

  it('deleteSelectedKeyframes: deletes across multiple clips', () => {
    const kf1 = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 });
    const kf2 = createMockKeyframe({ id: 'kf-2', clipId: 'clip-1', property: 'opacity', time: 1, value: 1 });
    const kf3 = createMockKeyframe({ id: 'kf-3', clipId: 'clip-2', property: 'opacity', time: 0, value: 0.8 });
    const kf4 = createMockKeyframe({ id: 'kf-4', clipId: 'clip-2', property: 'opacity', time: 2, value: 0.2 });
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', [kf1, kf2]);
    keyframeMap.set('clip-2', [kf3, kf4]);

    store = createTestTimelineStore({
      clips: [createMockClip({ id: 'clip-1' }), createMockClip({ id: 'clip-2', startTime: 5 })],
      clipKeyframes: keyframeMap,
      selectedKeyframeIds: new Set(['kf-1', 'kf-3']),
    } as any);

    store.getState().deleteSelectedKeyframes();
    const state = store.getState();
    // clip-1: kf-1 deleted, kf-2 remains
    expect(state.clipKeyframes.get('clip-1')?.length).toBe(1);
    expect(state.clipKeyframes.get('clip-1')?.[0].id).toBe('kf-2');
    // clip-2: kf-3 deleted, kf-4 remains
    expect(state.clipKeyframes.get('clip-2')?.length).toBe(1);
    expect(state.clipKeyframes.get('clip-2')?.[0].id).toBe('kf-4');
    expect(state.selectedKeyframeIds.size).toBe(0);
  });

  it('deleteSelectedKeyframes: deletes all selected from multiple clips, removes empty entries', () => {
    const kf1 = createMockKeyframe({ id: 'kf-1', clipId: 'clip-1', property: 'opacity', time: 0, value: 0.5 });
    const kf3 = createMockKeyframe({ id: 'kf-3', clipId: 'clip-2', property: 'opacity', time: 0, value: 0.8 });
    const kf4 = createMockKeyframe({ id: 'kf-4', clipId: 'clip-2', property: 'opacity', time: 2, value: 0.2 });
    const keyframeMap = new Map<string, Keyframe[]>();
    keyframeMap.set('clip-1', [kf1]);
    keyframeMap.set('clip-2', [kf3, kf4]);

    store = createTestTimelineStore({
      clips: [createMockClip({ id: 'clip-1' }), createMockClip({ id: 'clip-2', startTime: 5 })],
      clipKeyframes: keyframeMap,
      selectedKeyframeIds: new Set(['kf-1', 'kf-3', 'kf-4']),
    } as any);

    store.getState().deleteSelectedKeyframes();
    const state = store.getState();
    // Both clips' entries should be removed since all keyframes were deleted
    expect(state.clipKeyframes.has('clip-1')).toBe(false);
    expect(state.clipKeyframes.has('clip-2')).toBe(false);
    expect(state.selectedKeyframeIds.size).toBe(0);
  });

  // ─── Selection independence ──────────────────────────────────────────

  it('clip and keyframe selections are independent', () => {
    store.getState().selectClip('clip-1');
    store.getState().selectKeyframe('kf-1');
    const state = store.getState();
    expect(state.selectedClipIds.has('clip-1')).toBe(true);
    expect(state.selectedKeyframeIds.has('kf-1')).toBe(true);

    // Clearing clips does not affect keyframes
    store.getState().clearClipSelection();
    expect(store.getState().selectedKeyframeIds.has('kf-1')).toBe(true);

    // Clearing keyframes does not affect clips
    store.getState().selectClip('clip-2');
    store.getState().deselectAllKeyframes();
    expect(store.getState().selectedClipIds.has('clip-2')).toBe(true);
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });
});
