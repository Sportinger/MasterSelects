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

  it('updateKeyframe: changes value and easing', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateKeyframe(kfId, { value: 0.9, easing: 'ease-in' });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.value).toBe(0.9);
    expect(kf.easing).toBe('ease-in');
  });

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

  it('getClipKeyframes: returns keyframes for clip', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    store.getState().addKeyframe('clip-1', 'scale.x', 2, 3);
    const kfs = store.getState().getClipKeyframes('clip-1');
    expect(kfs.length).toBe(2);
  });

  it('getClipKeyframes: returns empty array for unknown clip', () => {
    expect(store.getState().getClipKeyframes('nonexistent')).toEqual([]);
  });

  it('hasKeyframes: returns true/false correctly', () => {
    expect(store.getState().hasKeyframes('clip-1')).toBe(false);
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    expect(store.getState().hasKeyframes('clip-1')).toBe(true);
    expect(store.getState().hasKeyframes('clip-1', 'opacity')).toBe(true);
    expect(store.getState().hasKeyframes('clip-1', 'scale.x')).toBe(false);
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

  it('toggleKeyframeRecording / isRecording', () => {
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(true);
    store.getState().toggleKeyframeRecording('clip-1', 'opacity');
    expect(store.getState().isRecording('clip-1', 'opacity')).toBe(false);
  });

  it('updateBezierHandle: sets handle and switches easing to bezier', () => {
    store.getState().addKeyframe('clip-1', 'opacity', 0.5, 1);
    const kfId = store.getState().clipKeyframes.get('clip-1')![0].id;
    store.getState().updateBezierHandle(kfId, 'out', { x: 0.3, y: 0.1 });
    const kf = store.getState().clipKeyframes.get('clip-1')![0];
    expect(kf.easing).toBe('bezier');
    expect(kf.handleOut).toEqual({ x: 0.3, y: 0.1 });
  });
});
