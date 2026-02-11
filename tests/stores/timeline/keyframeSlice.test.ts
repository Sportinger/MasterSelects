import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockKeyframe } from '../../helpers/mockData';
import type { Keyframe } from '../../../src/types';

describe('keyframeSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;
  const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10 });

  beforeEach(() => {
    store = createTestTimelineStore({ clips: [clip] } as any);
  });

  // ─── addKeyframe ───────────────────────────────────────────────────

  it('addKeyframe: creates keyframe in clipKeyframes map', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfs = store.getState().clipKeyframes.get('clip-1');
    expect(kfs).toBeDefined();
    expect(kfs!.length).toBe(1);
    expect(kfs![0].property).toBe('opacity');
    expect(kfs![0].value).toBe(0.5);
    expect(kfs![0].time).toBe(1);
    expect(kfs![0].clipId).toBe('clip-1');
  });

  it('addKeyframe: updates existing keyframe at same time', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 0.8, 1);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(1);
    expect(kfs[0].value).toBe(0.8);
  });

  it('addKeyframe: clamps time to clip duration', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 20); // beyond duration
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].time).toBe(10);
  });

  it('addKeyframe: keeps keyframes sorted by time', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 5);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 0.0, 8);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].time).toBe(1);
    expect(kfs[1].time).toBe(5);
    expect(kfs[2].time).toBe(8);
  });

  it('addKeyframe: clamps negative time to 0', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, -5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].time).toBe(0);
  });

  it('addKeyframe: does nothing for non-existent clip', () => {
    store.getState().addKeyframe('no-such-clip', 'opacity', 0.5, 1);
    expect(store.getState().clipKeyframes.get('no-such-clip')).toBeUndefined();
  });

  it('addKeyframe: uses playhead position when time is omitted', () => {
    // Set playhead to 3s (clip starts at 0, so local time = 3)
    store.setState({ playheadPosition: 3 } as any);
    store.getState().addKeyframe('clip-1', 'opacity', 0.7);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].time).toBe(3);
  });

  it('addKeyframe: playhead-based time accounts for clip startTime', () => {
    const offsetClip = createMockClip({ id: 'clip-offset', trackId: 'video-1', startTime: 5, duration: 10 });
    store = createTestTimelineStore({ clips: [offsetClip], playheadPosition: 8 } as any);
    store.getState().addKeyframe('clip-offset', 'opacity', 0.5);
    const kfs = store.getState().clipKeyframes.get('clip-offset')!;
    // playhead=8, startTime=5 => local time = 3
    expect(kfs[0].time).toBe(3);
  });

  it('addKeyframe: accepts custom easing parameter', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1, 'ease-in');
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].easing).toBe('ease-in');
  });

  it('addKeyframe: defaults easing to linear', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].easing).toBe('linear');
  });

  it('addKeyframe: generates unique IDs for different keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 3);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].id).not.toBe(kfs[1].id);
    expect(kfs[0].id).toMatch(/^kf_/);
    expect(kfs[1].id).toMatch(/^kf_/);
  });

  it('addKeyframe: update at same time also updates easing', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1, 'linear');
    store.getState().addKeyframe('clip-1', 'opacity', 0.8, 1, 'ease-out');
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].easing).toBe('ease-out');
  });

  it('addKeyframe: different properties at same time creates separate keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 1);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(2);
    const opacityKf = kfs.find(k => k.property === 'opacity');
    const scaleKf = kfs.find(k => k.property === 'scale.x');
    expect(opacityKf).toBeDefined();
    expect(scaleKf).toBeDefined();
  });

  // ─── removeKeyframe ────────────────────────────────────────────────

  it('removeKeyframe: removes from map', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().removeKeyframe(kfId);
    // When all keyframes removed, entry may be deleted
    const remaining = store.getState().clipKeyframes.get('clip-1');
    expect(!remaining || remaining.length === 0).toBe(true);
  });

  it('removeKeyframe: also removes from selectedKeyframeIds', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().selectKeyframe(kfId);
    expect(store.getState().selectedKeyframeIds.has(kfId)).toBe(true);
    store.getState().removeKeyframe(kfId);
    expect(store.getState().selectedKeyframeIds.has(kfId)).toBe(false);
  });

  it('removeKeyframe: deletes clip entry from map when last keyframe removed', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().removeKeyframe(kfId);
    // Entry should be completely removed from map, not just empty
    expect(store.getState().clipKeyframes.has('clip-1')).toBe(false);
  });

  it('removeKeyframe: keeps other keyframes when removing one', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    const firstId = kfs[0].id;
    store.getState().removeKeyframe(firstId);
    const remaining = store.getState().clipKeyframes.get('clip-1')!;
    expect(remaining.length).toBe(1);
    expect(remaining[0].time).toBe(5);
  });

  it('removeKeyframe: no-op for non-existent keyframe ID', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().removeKeyframe('non-existent-kf');
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(1);
  });

  // ─── updateKeyframe ────────────────────────────────────────────────

  it('updateKeyframe: changes value and easing', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateKeyframe(kfId, { value: 0.9, easing: 'ease-in' });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.value).toBe(0.9);
    expect(kf.easing).toBe('ease-in');
  });

  it('updateKeyframe: partial update only changes specified fields', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1, 'ease-out');
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateKeyframe(kfId, { value: 0.9 });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.value).toBe(0.9);
    expect(kf.easing).toBe('ease-out'); // unchanged
    expect(kf.time).toBe(1); // unchanged
  });

  it('updateKeyframe: can set bezier handles', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateKeyframe(kfId, {
      handleIn: { x: -0.2, y: 0 },
      handleOut: { x: 0.2, y: 1 },
    });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.handleIn).toEqual({ x: -0.2, y: 0 });
    expect(kf.handleOut).toEqual({ x: 0.2, y: 1 });
  });

  it('updateKeyframe: no-op for non-existent keyframe ID', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().updateKeyframe('non-existent', { value: 99 });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.value).toBe(0.5); // unchanged
  });

  // ─── moveKeyframe ─────────────────────────────────────────────────

  it('moveKeyframe: changes time, clamps to [0, duration]', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 5);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;

    store.getState().moveKeyframe(kfId, 3);
    expect(store.getState().clipKeyframes.get('clip-1')![0].time).toBe(3);

    store.getState().moveKeyframe(kfId, -5);
    expect(store.getState().clipKeyframes.get('clip-1')![0].time).toBe(0);

    store.getState().moveKeyframe(kfId, 100);
    expect(store.getState().clipKeyframes.get('clip-1')![0].time).toBe(10);
  });

  it('moveKeyframe: re-sorts keyframes after move', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    store.getState().addKeyframe('clip-1', 'opacity', 0.8, 8);
    // Move the first keyframe (time=1) to time=7 (between 5 and 8)
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().moveKeyframe(kfId, 7);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs[0].time).toBe(5);
    expect(kfs[1].time).toBe(7);
    expect(kfs[2].time).toBe(8);
  });

  it('moveKeyframe: preserves value and property during move', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.75, 2);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().moveKeyframe(kfId, 6);
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.value).toBe(0.75);
    expect(kf.property).toBe('opacity');
  });

  // ─── getClipKeyframes ─────────────────────────────────────────────

  it('getClipKeyframes: returns keyframes for clip', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 3);
    const kfs = store.getState().getClipKeyframes('clip-1');
    expect(kfs.length).toBe(2);
  });

  it('getClipKeyframes: returns empty array for unknown clip', () => {
    expect(store.getState().getClipKeyframes('nonexistent')).toEqual([]);
  });

  // ─── hasKeyframes ─────────────────────────────────────────────────

  it('hasKeyframes: returns true/false correctly', () => {
    expect(store.getState().hasKeyframes('clip-1')).toBe(false);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    expect(store.getState().hasKeyframes('clip-1')).toBe(true);
    expect(store.getState().hasKeyframes('clip-1', 'opacity')).toBe(true);
    expect(store.getState().hasKeyframes('clip-1', 'scale.x')).toBe(false);
  });

  it('hasKeyframes: returns false for unknown clip', () => {
    expect(store.getState().hasKeyframes('no-such-clip')).toBe(false);
  });

  it('hasKeyframes: returns false for unknown clip with property', () => {
    expect(store.getState().hasKeyframes('no-such-clip', 'opacity')).toBe(false);
  });

  it('multiple keyframes per property, sorted by time', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0, 0);
    store.getState().addKeyframe('clip-1', 'opacity', 1, 5);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 2.5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!.filter(k => k.property === 'opacity');
    expect(kfs[0].time).toBe(0);
    expect(kfs[1].time).toBe(2.5);
    expect(kfs[2].time).toBe(5);
  });

  // ─── toggleKeyframeRecording / isRecording ─────────────────────────

  it('toggleKeyframeRecording / isRecording', () => {
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(true);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
  });

  it('toggleKeyframeRecording: independent per property', () => {
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    store.getState().toggleKeyframeRecording('clip-1', 'scale.x');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(true);
    expect(store.getState().isRecording('clip-1', 'scale.x')).toBe(true);
    // Toggle off opacity only
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
    expect(store.getState().isRecording('clip-1', 'scale.x')).toBe(true);
  });

  it('toggleKeyframeRecording: independent per clip', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 10, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(true);
    expect(store.getState().isRecording('clip-2', 'opacity')).toBe(false);
  });

  // ─── updateBezierHandle ────────────────────────────────────────────

  it('updateBezierHandle: sets handle and switches easing to bezier', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateBezierHandle(kfId, 'out', { x: 0.3, y: 0.1 });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.easing).toBe('bezier');
    expect(kf.handleOut).toEqual({ x: 0.3, y: 0.1 });
  });

  it('updateBezierHandle: sets "in" handle correctly', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateBezierHandle(kfId, 'in', { x: -0.3, y: 0.8 });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.easing).toBe('bezier');
    expect(kf.handleIn).toEqual({ x: -0.3, y: 0.8 });
  });

  it('updateBezierHandle: only modifies targeted keyframe', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    const firstId = kfs[0].id;
    store.getState().updateBezierHandle(firstId, 'out', { x: 0.3, y: 0.1 });
    const updatedKfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(updatedKfs[0].easing).toBe('bezier');
    expect(updatedKfs[1].easing).toBe('linear'); // untouched
  });

  // ─── selectKeyframe / deselectAllKeyframes ─────────────────────────

  it('selectKeyframe: single selection replaces previous selection', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    store.getState().selectKeyframe(kfs[0].id);
    expect(store.getState().selectedKeyframeIds.has(kfs[0].id)).toBe(true);
    store.getState().selectKeyframe(kfs[1].id);
    expect(store.getState().selectedKeyframeIds.has(kfs[1].id)).toBe(true);
    expect(store.getState().selectedKeyframeIds.has(kfs[0].id)).toBe(false);
  });

  it('selectKeyframe: addToSelection accumulates selections', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    store.getState().selectKeyframe(kfs[0].id);
    store.getState().selectKeyframe(kfs[1].id, true);
    expect(store.getState().selectedKeyframeIds.size).toBe(2);
    expect(store.getState().selectedKeyframeIds.has(kfs[0].id)).toBe(true);
    expect(store.getState().selectedKeyframeIds.has(kfs[1].id)).toBe(true);
  });

  it('selectKeyframe: addToSelection toggles off already-selected', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().selectKeyframe(kfId);
    expect(store.getState().selectedKeyframeIds.has(kfId)).toBe(true);
    store.getState().selectKeyframe(kfId, true);
    expect(store.getState().selectedKeyframeIds.has(kfId)).toBe(false);
  });

  it('deselectAllKeyframes: clears all selections', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    store.getState().selectKeyframe(kfs[0].id);
    store.getState().selectKeyframe(kfs[1].id, true);
    expect(store.getState().selectedKeyframeIds.size).toBe(2);
    store.getState().deselectAllKeyframes();
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  // ─── deleteSelectedKeyframes ───────────────────────────────────────

  it('deleteSelectedKeyframes: removes selected keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    store.getState().selectKeyframe(kfs[0].id);
    store.getState().selectKeyframe(kfs[1].id, true);
    store.getState().deleteSelectedKeyframes();
    const remaining = store.getState().clipKeyframes.get('clip-1');
    expect(!remaining || remaining.length === 0).toBe(true);
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  it('deleteSelectedKeyframes: no-op when nothing selected', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().deleteSelectedKeyframes();
    expect(store.getState().clipKeyframes.get('clip-1')!.length).toBe(1);
  });

  it('deleteSelectedKeyframes: keeps non-selected keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 0.8, 3);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    store.getState().selectKeyframe(kfs[1].id); // select middle one
    store.getState().deleteSelectedKeyframes();
    const remaining = store.getState().clipKeyframes.get('clip-1')!;
    expect(remaining.length).toBe(2);
    expect(remaining[0].time).toBe(1);
    expect(remaining[1].time).toBe(5);
  });

  // ─── toggleTrackExpanded / isTrackExpanded ─────────────────────────

  it('toggleTrackExpanded: toggles track expansion state', () => {
    // Default state has video-1 expanded
    expect(store.getState().isTrackExpanded('video-1')).toBe(true);
    store.getState().toggleTrackExpanded('video-1');
    expect(store.getState().isTrackExpanded('video-1')).toBe(false);
    store.getState().toggleTrackExpanded('video-1');
    expect(store.getState().isTrackExpanded('video-1')).toBe(true);
  });

  it('isTrackExpanded: returns false for unknown track', () => {
    expect(store.getState().isTrackExpanded('no-such-track')).toBe(false);
  });

  // ─── toggleTrackPropertyGroupExpanded / isTrackPropertyGroupExpanded

  it('toggleTrackPropertyGroupExpanded: toggles property group', () => {
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Position')).toBe(false);
    store.getState().toggleTrackPropertyGroupExpanded('video-1', 'Position');
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Position')).toBe(true);
    store.getState().toggleTrackPropertyGroupExpanded('video-1', 'Position');
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Position')).toBe(false);
  });

  it('toggleTrackPropertyGroupExpanded: independent per group', () => {
    store.getState().toggleTrackPropertyGroupExpanded('video-1', 'Position');
    store.getState().toggleTrackPropertyGroupExpanded('video-1', 'Scale');
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Position')).toBe(true);
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Scale')).toBe(true);
    store.getState().toggleTrackPropertyGroupExpanded('video-1', 'Position');
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Position')).toBe(false);
    expect(store.getState().isTrackPropertyGroupExpanded('video-1', 'Scale')).toBe(true);
  });

  // ─── trackHasKeyframes ─────────────────────────────────────────────

  it('trackHasKeyframes: returns false when no keyframes', () => {
    expect(store.getState().trackHasKeyframes('video-1')).toBe(false);
  });

  it('trackHasKeyframes: returns true when clip on track has keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    expect(store.getState().trackHasKeyframes('video-1')).toBe(true);
  });

  it('trackHasKeyframes: returns false for track with no clips', () => {
    expect(store.getState().trackHasKeyframes('audio-1')).toBe(false);
  });

  it('trackHasKeyframes: checks multiple clips on track', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 15, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    // Only clip-2 has keyframes
    store.getState().addKeyframe('clip-2', 'opacity', 0.5, 1);
    expect(store.getState().trackHasKeyframes('video-1')).toBe(true);
  });

  // ─── toggleCurveExpanded / isCurveExpanded ─────────────────────────

  it('toggleCurveExpanded: opens curve editor for property', () => {
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(false);
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(true);
  });

  it('toggleCurveExpanded: toggles off when already open', () => {
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(true);
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(false);
  });

  it('toggleCurveExpanded: only one curve editor open at a time', () => {
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(true);
    // Open a different property curve editor
    store.getState().toggleCurveExpanded('video-1', 'scale.x');
    expect(store.getState().isCurveExpanded('video-1', 'scale.x')).toBe(true);
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(false);
  });

  it('toggleCurveExpanded: only one curve editor across tracks', () => {
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    store.getState().toggleCurveExpanded('audio-1', 'opacity');
    expect(store.getState().isCurveExpanded('audio-1', 'opacity')).toBe(true);
    expect(store.getState().isCurveExpanded('video-1', 'opacity')).toBe(false);
  });

  // ─── setCurveEditorHeight ──────────────────────────────────────────

  it('setCurveEditorHeight: sets height', () => {
    store.getState().setCurveEditorHeight(300);
    expect(store.getState().curveEditorHeight).toBe(300);
  });

  it('setCurveEditorHeight: clamps to minimum (80)', () => {
    store.getState().setCurveEditorHeight(10);
    expect(store.getState().curveEditorHeight).toBe(80);
  });

  it('setCurveEditorHeight: clamps to maximum (600)', () => {
    store.getState().setCurveEditorHeight(1000);
    expect(store.getState().curveEditorHeight).toBe(600);
  });

  it('setCurveEditorHeight: rounds to integer', () => {
    store.getState().setCurveEditorHeight(250.7);
    expect(store.getState().curveEditorHeight).toBe(251);
  });

  // ─── getExpandedTrackHeight ────────────────────────────────────────

  it('getExpandedTrackHeight: returns baseHeight when track not expanded', () => {
    store.getState().toggleTrackExpanded('video-1'); // collapse it
    expect(store.getState().getExpandedTrackHeight('video-1', 60)).toBe(60);
  });

  it('getExpandedTrackHeight: returns baseHeight when no clip selected in track', () => {
    // Track is expanded by default, but no clip is selected
    expect(store.getState().getExpandedTrackHeight('video-1', 60)).toBe(60);
  });

  it('getExpandedTrackHeight: returns baseHeight when selected clip has no keyframes', () => {
    store.getState().selectClip('clip-1');
    expect(store.getState().getExpandedTrackHeight('video-1', 60)).toBe(60);
  });

  it('getExpandedTrackHeight: adds property row height for keyframed properties', () => {
    store.getState().selectClip('clip-1');
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 1);
    // 2 unique properties * PROPERTY_ROW_HEIGHT(18) = 36 extra
    const height = store.getState().getExpandedTrackHeight('video-1', 60);
    expect(height).toBe(60 + 2 * 18);
  });

  it('getExpandedTrackHeight: adds curve editor height when curve is expanded', () => {
    store.getState().selectClip('clip-1');
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().toggleCurveExpanded('video-1', 'opacity');
    // 1 property row (18) + curve editor height (250)
    const height = store.getState().getExpandedTrackHeight('video-1', 60);
    expect(height).toBe(60 + 18 + 250);
  });

  // ─── getInterpolatedTransform ──────────────────────────────────────

  it('getInterpolatedTransform: returns default transform for unknown clip', () => {
    const t = store.getState().getInterpolatedTransform('nonexistent', 0);
    expect(t.opacity).toBe(1);
    expect(t.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(t.scale).toEqual({ x: 1, y: 1 });
    expect(t.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('getInterpolatedTransform: returns base transform when no keyframes', () => {
    const t = store.getState().getInterpolatedTransform('clip-1', 0);
    expect(t.opacity).toBe(1);
  });

  it('getInterpolatedTransform: interpolates opacity keyframes', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0, 0);
    store.getState().addKeyframe('clip-1', 'opacity', 1, 10);
    const t = store.getState().getInterpolatedTransform('clip-1', 5);
    expect(t.opacity).toBeCloseTo(0.5, 1);
  });

  // ─── getInterpolatedEffects ────────────────────────────────────────

  it('getInterpolatedEffects: returns empty array for unknown clip', () => {
    const effects = store.getState().getInterpolatedEffects('nonexistent', 0);
    expect(effects).toEqual([]);
  });

  it('getInterpolatedEffects: returns clip effects when no keyframes', () => {
    const effectClip = createMockClip({
      id: 'clip-fx',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      effects: [{ id: 'fx-1', type: 'brightness', enabled: true, params: { brightness: 1.5 } }],
    });
    store = createTestTimelineStore({ clips: [effectClip] } as any);
    const effects = store.getState().getInterpolatedEffects('clip-fx', 0);
    expect(effects.length).toBe(1);
    expect(effects[0].params.brightness).toBe(1.5);
  });

  it('getInterpolatedEffects: interpolates effect keyframes', () => {
    const effectClip = createMockClip({
      id: 'clip-fx',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      effects: [{ id: 'fx-1', type: 'brightness', enabled: true, params: { brightness: 1.0 } }],
    });
    store = createTestTimelineStore({ clips: [effectClip] } as any);
    store.getState().addKeyframe('clip-fx', 'effect.fx-1.brightness' as any, 0.5, 0);
    store.getState().addKeyframe('clip-fx', 'effect.fx-1.brightness' as any, 2.0, 10);
    const effects = store.getState().getInterpolatedEffects('clip-fx', 5);
    expect(effects[0].params.brightness).toBeCloseTo(1.25, 1);
  });

  // ─── getInterpolatedSpeed ──────────────────────────────────────────

  it('getInterpolatedSpeed: returns 1 for unknown clip', () => {
    expect(store.getState().getInterpolatedSpeed('nonexistent', 0)).toBe(1);
  });

  it('getInterpolatedSpeed: returns clip default speed when no keyframes', () => {
    const speedClip = createMockClip({
      id: 'clip-speed',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      speed: 2,
    });
    store = createTestTimelineStore({ clips: [speedClip] } as any);
    expect(store.getState().getInterpolatedSpeed('clip-speed', 5)).toBe(2);
  });

  // ─── getSourceTimeForClip ──────────────────────────────────────────

  it('getSourceTimeForClip: returns clipLocalTime for unknown clip', () => {
    expect(store.getState().getSourceTimeForClip('nonexistent', 5)).toBe(5);
  });

  it('getSourceTimeForClip: returns clipLocalTime when speed is 1 and no keyframes', () => {
    expect(store.getState().getSourceTimeForClip('clip-1', 3)).toBe(3);
  });

  // ─── setPropertyValue ──────────────────────────────────────────────

  it('setPropertyValue: creates keyframe when recording is enabled', () => {
    store.setState({ playheadPosition: 3 } as any);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    store.getState().setPropertyValue('clip-1', 'opacity', 0.7);
    const kfs = store.getState().clipKeyframes.get('clip-1');
    expect(kfs).toBeDefined();
    expect(kfs!.length).toBe(1);
    expect(kfs![0].value).toBe(0.7);
  });

  it('setPropertyValue: updates static value when not recording and no keyframes', () => {
    store.getState().setPropertyValue('clip-1', 'opacity', 0.5);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.opacity).toBe(0.5);
    // No keyframes should be created
    expect(store.getState().clipKeyframes.get('clip-1')).toBeUndefined();
  });

  it('setPropertyValue: creates keyframe when property already has keyframes (even if not recording)', () => {
    // Add initial keyframe
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 0);
    // setPropertyValue should add keyframe since property already has keyframes
    store.setState({ playheadPosition: 5 } as any);
    store.getState().setPropertyValue('clip-1', 'opacity', 0.3);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(2);
  });

  it('setPropertyValue: handles position.x as transform update when not recording', () => {
    store.getState().setPropertyValue('clip-1', 'position.x', 100);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.position.x).toBe(100);
  });

  it('setPropertyValue: handles scale.y as transform update when not recording', () => {
    store.getState().setPropertyValue('clip-1', 'scale.y', 2.5);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.scale.y).toBe(2.5);
  });

  it('setPropertyValue: handles rotation.z as transform update when not recording', () => {
    store.getState().setPropertyValue('clip-1', 'rotation.z', 45);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.rotation.z).toBe(45);
  });

  it('setPropertyValue: does nothing for non-existent clip', () => {
    store.getState().setPropertyValue('nonexistent', 'opacity', 0.5);
    // Should not throw or alter state
    expect(store.getState().clips.length).toBe(1);
  });

  // ─── disablePropertyKeyframes ──────────────────────────────────────

  it('disablePropertyKeyframes: removes all keyframes for property', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 1.0, 5);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 3);
    store.getState().disablePropertyKeyframes('clip-1', 'opacity', 0.7);
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(1);
    expect(kfs[0].property).toBe('scale.x');
  });

  it('disablePropertyKeyframes: writes current value to clip transform', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().disablePropertyKeyframes('clip-1', 'opacity', 0.75);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.opacity).toBe(0.75);
  });

  it('disablePropertyKeyframes: disables recording for property', () => {
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(true);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().disablePropertyKeyframes('clip-1', 'opacity', 0.5);
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
  });

  it('disablePropertyKeyframes: removes clip entry from map when all keyframes removed', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().disablePropertyKeyframes('clip-1', 'opacity', 0.5);
    expect(store.getState().clipKeyframes.has('clip-1')).toBe(false);
  });

  it('disablePropertyKeyframes: does nothing for non-existent clip', () => {
    store.getState().disablePropertyKeyframes('nonexistent', 'opacity', 0.5);
    // Should not throw
    expect(store.getState().clips.length).toBe(1);
  });

  it('disablePropertyKeyframes: writes position property to clip transform', () => {
    store.getState().addKeyframe('clip-1', 'position.x', 100, 1);
    store.getState().disablePropertyKeyframes('clip-1', 'position.x', 50);
    const updatedClip = store.getState().clips.find(c => c.id === 'clip-1')!;
    expect(updatedClip.transform.position.x).toBe(50);
  });

  // ─── Multiple clips with keyframes ─────────────────────────────────

  it('keyframes are isolated between clips', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 15, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-2', 'opacity', 0.8, 2);
    expect(store.getState().clipKeyframes.get('clip-1')!.length).toBe(1);
    expect(store.getState().clipKeyframes.get('clip-2')!.length).toBe(1);
    expect(store.getState().clipKeyframes.get('clip-1')![0].value).toBe(0.5);
    expect(store.getState().clipKeyframes.get('clip-2')![0].value).toBe(0.8);
  });

  it('removing keyframe from one clip does not affect another', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 15, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-2', 'opacity', 0.8, 2);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().removeKeyframe(kfId);
    expect(store.getState().clipKeyframes.has('clip-1')).toBe(false);
    expect(store.getState().clipKeyframes.get('clip-2')!.length).toBe(1);
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  it('addKeyframe: time exactly at clip boundary 0 is valid', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 0);
    expect(store.getState().clipKeyframes.get('clip-1')![0].time).toBe(0);
  });

  it('addKeyframe: time exactly at clip duration is valid', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 10);
    expect(store.getState().clipKeyframes.get('clip-1')![0].time).toBe(10);
  });

  it('addKeyframe: supports all easing types', () => {
    const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'] as const;
    easings.forEach((easing, i) => {
      store.getState().addKeyframe('clip-1', 'opacity', 0.5, i, easing);
    });
    const kfs = store.getState().clipKeyframes.get('clip-1')!;
    expect(kfs.length).toBe(5);
    expect(kfs[0].easing).toBe('linear');
    expect(kfs[1].easing).toBe('ease-in');
    expect(kfs[2].easing).toBe('ease-out');
    expect(kfs[3].easing).toBe('ease-in-out');
    expect(kfs[4].easing).toBe('bezier');
  });

  it('addKeyframe: supports effect property naming pattern', () => {
    const effectClip = createMockClip({
      id: 'clip-fx',
      trackId: 'video-1',
      startTime: 0,
      duration: 10,
      effects: [{ id: 'fx-1', type: 'brightness', enabled: true, params: { brightness: 1.0 } }],
    });
    store = createTestTimelineStore({ clips: [effectClip] } as any);
    store.getState().addKeyframe('clip-fx', 'effect.fx-1.brightness' as any, 2.0, 5);
    const kfs = store.getState().clipKeyframes.get('clip-fx')!;
    expect(kfs[0].property).toBe('effect.fx-1.brightness');
    expect(kfs[0].value).toBe(2.0);
  });
});
