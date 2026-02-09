import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('playbackSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

  it('setPlayheadPosition: clamps to [0, duration]', () => {
    store.getState().setPlayheadPosition(30);
    expect(store.getState().playheadPosition).toBe(30);

    store.getState().setPlayheadPosition(-5);
    expect(store.getState().playheadPosition).toBe(0);

    store.getState().setPlayheadPosition(999);
    expect(store.getState().playheadPosition).toBe(60); // default duration
  });

  it('pause: sets isPlaying to false and resets speed to 1', () => {
    store.setState({ isPlaying: true, playbackSpeed: 4 });
    store.getState().pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('stop: sets isPlaying false and resets playhead to 0', () => {
    store.setState({ isPlaying: true, playheadPosition: 30 });
    store.getState().stop();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playheadPosition).toBe(0);
  });

  it('setZoom: clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    store.getState().setZoom(100);
    expect(store.getState().zoom).toBe(100);

    store.getState().setZoom(0.001);
    expect(store.getState().zoom).toBe(0.1); // MIN_ZOOM

    store.getState().setZoom(999);
    expect(store.getState().zoom).toBe(200); // MAX_ZOOM
  });

  it('toggleSnapping: toggles snappingEnabled', () => {
    expect(store.getState().snappingEnabled).toBe(true);
    store.getState().toggleSnapping();
    expect(store.getState().snappingEnabled).toBe(false);
    store.getState().toggleSnapping();
    expect(store.getState().snappingEnabled).toBe(true);
  });

  it('setScrollX: clamps to >= 0', () => {
    store.getState().setScrollX(50);
    expect(store.getState().scrollX).toBe(50);

    store.getState().setScrollX(-10);
    expect(store.getState().scrollX).toBe(0);
  });

  // ─── In/Out markers ──────────────────────────────────────────────────

  it('setInPoint: sets in point, clamped to [0, outPoint]', () => {
    store.getState().setInPoint(10);
    expect(store.getState().inPoint).toBe(10);

    store.getState().setInPoint(-5);
    expect(store.getState().inPoint).toBe(0);
  });

  it('setInPoint(null): clears in point', () => {
    store.getState().setInPoint(10);
    store.getState().setInPoint(null);
    expect(store.getState().inPoint).toBeNull();
  });

  it('setOutPoint: sets out point, clamped to [inPoint, duration]', () => {
    store.getState().setInPoint(10);
    store.getState().setOutPoint(30);
    expect(store.getState().outPoint).toBe(30);

    // Can't go below in point
    store.getState().setOutPoint(5);
    expect(store.getState().outPoint).toBe(10);
  });

  it('setOutPoint(null): clears out point', () => {
    store.getState().setOutPoint(30);
    store.getState().setOutPoint(null);
    expect(store.getState().outPoint).toBeNull();
  });

  it('clearInOut: clears both', () => {
    store.getState().setInPoint(10);
    store.getState().setOutPoint(30);
    store.getState().clearInOut();
    expect(store.getState().inPoint).toBeNull();
    expect(store.getState().outPoint).toBeNull();
  });

  it('setInPointAtPlayhead: sets in point to playhead position', () => {
    store.getState().setPlayheadPosition(15);
    store.getState().setInPointAtPlayhead();
    expect(store.getState().inPoint).toBe(15);
  });

  it('setOutPointAtPlayhead: sets out point to playhead position', () => {
    store.getState().setPlayheadPosition(25);
    store.getState().setOutPointAtPlayhead();
    expect(store.getState().outPoint).toBe(25);
  });

  // ─── Loop ────────────────────────────────────────────────────────────

  it('setLoopPlayback / toggleLoopPlayback', () => {
    expect(store.getState().loopPlayback).toBe(false);
    store.getState().setLoopPlayback(true);
    expect(store.getState().loopPlayback).toBe(true);
    store.getState().toggleLoopPlayback();
    expect(store.getState().loopPlayback).toBe(false);
  });

  // ─── Playback speed ──────────────────────────────────────────────────

  it('setPlaybackSpeed: sets speed', () => {
    store.getState().setPlaybackSpeed(2);
    expect(store.getState().playbackSpeed).toBe(2);
  });

  // ─── Tool mode ───────────────────────────────────────────────────────

  it('setToolMode / toggleCutTool', () => {
    expect(store.getState().toolMode).toBe('select');
    store.getState().setToolMode('cut');
    expect(store.getState().toolMode).toBe('cut');
    store.getState().toggleCutTool();
    expect(store.getState().toolMode).toBe('select');
    store.getState().toggleCutTool();
    expect(store.getState().toolMode).toBe('cut');
  });
});
