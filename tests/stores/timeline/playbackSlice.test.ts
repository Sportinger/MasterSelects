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

  it('setPlayheadPosition: clamps to exact duration boundary', () => {
    store.getState().setPlayheadPosition(60);
    expect(store.getState().playheadPosition).toBe(60);
  });

  it('setPlayheadPosition: handles zero correctly', () => {
    store.getState().setPlayheadPosition(30);
    store.getState().setPlayheadPosition(0);
    expect(store.getState().playheadPosition).toBe(0);
  });

  it('pause: sets isPlaying to false and resets speed to 1', () => {
    store.setState({ isPlaying: true, playbackSpeed: 4 });
    store.getState().pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('pause: resets negative playback speed to 1', () => {
    store.setState({ isPlaying: true, playbackSpeed: -4 });
    store.getState().pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('pause: no-op on speed if already paused', () => {
    // Even if not playing, pause still sets speed to 1
    store.setState({ isPlaying: false, playbackSpeed: 2 });
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

  it('stop: works when already stopped', () => {
    store.setState({ isPlaying: false, playheadPosition: 15 });
    store.getState().stop();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playheadPosition).toBe(0);
  });

  // ─── play ─────────────────────────────────────────────────────────────

  it('play: sets isPlaying to true', async () => {
    expect(store.getState().isPlaying).toBe(false);
    await store.getState().play();
    expect(store.getState().isPlaying).toBe(true);
  });

  it('play: remains true if already playing', async () => {
    await store.getState().play();
    await store.getState().play();
    expect(store.getState().isPlaying).toBe(true);
  });

  // ─── setDraggingPlayhead ──────────────────────────────────────────────

  it('setDraggingPlayhead: sets isDraggingPlayhead to true', () => {
    expect(store.getState().isDraggingPlayhead).toBe(false);
    store.getState().setDraggingPlayhead(true);
    expect(store.getState().isDraggingPlayhead).toBe(true);
  });

  it('setDraggingPlayhead: sets isDraggingPlayhead to false', () => {
    store.getState().setDraggingPlayhead(true);
    store.getState().setDraggingPlayhead(false);
    expect(store.getState().isDraggingPlayhead).toBe(false);
  });

  // ─── Zoom ─────────────────────────────────────────────────────────────

  it('setZoom: clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    store.getState().setZoom(100);
    expect(store.getState().zoom).toBe(100);

    store.getState().setZoom(0.001);
    expect(store.getState().zoom).toBe(0.1); // MIN_ZOOM

    store.getState().setZoom(999);
    expect(store.getState().zoom).toBe(200); // MAX_ZOOM
  });

  it('setZoom: accepts exact boundary values', () => {
    store.getState().setZoom(0.1);
    expect(store.getState().zoom).toBe(0.1);

    store.getState().setZoom(200);
    expect(store.getState().zoom).toBe(200);
  });

  it('setZoom: handles fractional zoom levels', () => {
    store.getState().setZoom(15.5);
    expect(store.getState().zoom).toBe(15.5);
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

  it('setScrollX: allows zero', () => {
    store.getState().setScrollX(100);
    store.getState().setScrollX(0);
    expect(store.getState().scrollX).toBe(0);
  });

  it('setScrollX: handles large values', () => {
    store.getState().setScrollX(100000);
    expect(store.getState().scrollX).toBe(100000);
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

  it('setInPoint: clamps to duration when no outPoint set', () => {
    // duration is 60 by default, no out point set
    store.getState().setInPoint(100);
    expect(store.getState().inPoint).toBe(60);
  });

  it('setInPoint: clamps to outPoint when outPoint exists', () => {
    store.getState().setOutPoint(20);
    store.getState().setInPoint(25);
    expect(store.getState().inPoint).toBe(20);
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

  it('setOutPoint: clamps to duration', () => {
    store.getState().setOutPoint(100);
    expect(store.getState().outPoint).toBe(60); // duration is 60
  });

  it('setOutPoint: uses 0 as floor when no inPoint set', () => {
    // no in point set, so inPoint ?? 0 = 0
    store.getState().setOutPoint(-5);
    expect(store.getState().outPoint).toBe(0);
  });

  it('clearInOut: clears both', () => {
    store.getState().setInPoint(10);
    store.getState().setOutPoint(30);
    store.getState().clearInOut();
    expect(store.getState().inPoint).toBeNull();
    expect(store.getState().outPoint).toBeNull();
  });

  it('clearInOut: no-op when both already null', () => {
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

  it('setInPointAtPlayhead: respects outPoint clamping', () => {
    store.getState().setOutPoint(10);
    store.getState().setPlayheadPosition(20);
    store.getState().setInPointAtPlayhead();
    // in point should be clamped to outPoint (10)
    expect(store.getState().inPoint).toBe(10);
  });

  it('setOutPointAtPlayhead: respects inPoint clamping', () => {
    store.getState().setInPoint(30);
    store.getState().setPlayheadPosition(10);
    store.getState().setOutPointAtPlayhead();
    // out point should be clamped to inPoint (30)
    expect(store.getState().outPoint).toBe(30);
  });

  // ─── Loop ────────────────────────────────────────────────────────────

  it('setLoopPlayback / toggleLoopPlayback', () => {
    expect(store.getState().loopPlayback).toBe(false);
    store.getState().setLoopPlayback(true);
    expect(store.getState().loopPlayback).toBe(true);
    store.getState().toggleLoopPlayback();
    expect(store.getState().loopPlayback).toBe(false);
  });

  it('setLoopPlayback: explicitly sets to false', () => {
    store.getState().setLoopPlayback(true);
    store.getState().setLoopPlayback(false);
    expect(store.getState().loopPlayback).toBe(false);
  });

  it('toggleLoopPlayback: multiple toggles cycle correctly', () => {
    store.getState().toggleLoopPlayback();
    expect(store.getState().loopPlayback).toBe(true);
    store.getState().toggleLoopPlayback();
    expect(store.getState().loopPlayback).toBe(false);
    store.getState().toggleLoopPlayback();
    expect(store.getState().loopPlayback).toBe(true);
  });

  // ─── Playback speed ──────────────────────────────────────────────────

  it('setPlaybackSpeed: sets speed', () => {
    store.getState().setPlaybackSpeed(2);
    expect(store.getState().playbackSpeed).toBe(2);
  });

  it('setPlaybackSpeed: allows negative speed', () => {
    store.getState().setPlaybackSpeed(-2);
    expect(store.getState().playbackSpeed).toBe(-2);
  });

  it('setPlaybackSpeed: allows fractional speed', () => {
    store.getState().setPlaybackSpeed(0.5);
    expect(store.getState().playbackSpeed).toBe(0.5);
  });

  it('setPlaybackSpeed: allows zero (freeze frame)', () => {
    store.getState().setPlaybackSpeed(0);
    expect(store.getState().playbackSpeed).toBe(0);
  });

  // ─── JKL Playback Control ─────────────────────────────────────────────

  it('playForward: starts playing at speed 1 when not playing', async () => {
    expect(store.getState().isPlaying).toBe(false);
    store.getState().playForward();
    // play() is async, wait for it
    await new Promise(r => setTimeout(r, 0));
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('playForward: switches from reverse to forward', async () => {
    // Start playing in reverse
    store.setState({ isPlaying: true, playbackSpeed: -2 });
    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('playForward: doubles speed when already playing forward (1->2->4->8)', () => {
    store.setState({ isPlaying: true, playbackSpeed: 1 });
    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(2);

    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(4);

    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(8);
  });

  it('playForward: caps at 8x speed', () => {
    store.setState({ isPlaying: true, playbackSpeed: 8 });
    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(8);
  });

  it('playReverse: starts playing at speed -1 when not playing', async () => {
    expect(store.getState().isPlaying).toBe(false);
    store.getState().playReverse();
    await new Promise(r => setTimeout(r, 0));
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().playbackSpeed).toBe(-1);
  });

  it('playReverse: switches from forward to reverse', () => {
    store.setState({ isPlaying: true, playbackSpeed: 2 });
    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-1);
  });

  it('playReverse: doubles reverse speed (-1->-2->-4->-8)', () => {
    store.setState({ isPlaying: true, playbackSpeed: -1 });
    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-2);

    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-4);

    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-8);
  });

  it('playReverse: caps at -8x speed', () => {
    store.setState({ isPlaying: true, playbackSpeed: -8 });
    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-8);
  });

  // ─── setDuration ──────────────────────────────────────────────────────

  it('setDuration: sets duration and locks it', () => {
    expect(store.getState().durationLocked).toBe(false);
    store.getState().setDuration(120);
    expect(store.getState().duration).toBe(120);
    expect(store.getState().durationLocked).toBe(true);
  });

  it('setDuration: enforces minimum of 1 second', () => {
    store.getState().setDuration(0);
    expect(store.getState().duration).toBe(1);

    store.getState().setDuration(-10);
    expect(store.getState().duration).toBe(1);

    store.getState().setDuration(0.5);
    expect(store.getState().duration).toBe(1);
  });

  it('setDuration: clamps playhead if beyond new duration', () => {
    store.getState().setPlayheadPosition(50);
    store.getState().setDuration(30);
    expect(store.getState().playheadPosition).toBe(30);
  });

  it('setDuration: does not move playhead if within new duration', () => {
    store.getState().setPlayheadPosition(10);
    store.getState().setDuration(30);
    expect(store.getState().playheadPosition).toBe(10);
  });

  it('setDuration: clamps inPoint if beyond new duration', () => {
    store.getState().setInPoint(50);
    store.getState().setDuration(30);
    expect(store.getState().inPoint).toBe(30);
  });

  it('setDuration: clamps outPoint if beyond new duration', () => {
    store.getState().setOutPoint(50);
    store.getState().setDuration(30);
    expect(store.getState().outPoint).toBe(30);
  });

  it('setDuration: does not clamp null inPoint/outPoint', () => {
    store.getState().setDuration(30);
    expect(store.getState().inPoint).toBeNull();
    expect(store.getState().outPoint).toBeNull();
  });

  it('setDuration: clamps both playhead and markers simultaneously', () => {
    store.getState().setPlayheadPosition(40);
    store.getState().setInPoint(35);
    store.getState().setOutPoint(45);
    store.getState().setDuration(20);
    expect(store.getState().playheadPosition).toBe(20);
    expect(store.getState().inPoint).toBe(20);
    expect(store.getState().outPoint).toBe(20);
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

  it('setToolMode: sets to select explicitly', () => {
    store.getState().setToolMode('cut');
    store.getState().setToolMode('select');
    expect(store.getState().toolMode).toBe('select');
  });

  // ─── Clip animation phase ─────────────────────────────────────────────

  it('setClipAnimationPhase: sets idle', () => {
    store.getState().setClipAnimationPhase('exiting');
    store.getState().setClipAnimationPhase('idle');
    expect(store.getState().clipAnimationPhase).toBe('idle');
  });

  it('setClipAnimationPhase: sets exiting', () => {
    store.getState().setClipAnimationPhase('exiting');
    expect(store.getState().clipAnimationPhase).toBe('exiting');
  });

  it('setClipAnimationPhase: sets entering', () => {
    store.getState().setClipAnimationPhase('entering');
    expect(store.getState().clipAnimationPhase).toBe('entering');
  });

  // ─── Slot grid progress ───────────────────────────────────────────────

  it('setSlotGridProgress: sets value within [0, 1]', () => {
    store.getState().setSlotGridProgress(0.5);
    expect(store.getState().slotGridProgress).toBe(0.5);
  });

  it('setSlotGridProgress: clamps to 0 for negative values', () => {
    store.getState().setSlotGridProgress(-0.5);
    expect(store.getState().slotGridProgress).toBe(0);
  });

  it('setSlotGridProgress: clamps to 1 for values above 1', () => {
    store.getState().setSlotGridProgress(1.5);
    expect(store.getState().slotGridProgress).toBe(1);
  });

  it('setSlotGridProgress: accepts exact boundaries', () => {
    store.getState().setSlotGridProgress(0);
    expect(store.getState().slotGridProgress).toBe(0);

    store.getState().setSlotGridProgress(1);
    expect(store.getState().slotGridProgress).toBe(1);
  });

  // ─── Performance toggles ──────────────────────────────────────────────

  it('toggleThumbnailsEnabled: toggles state', () => {
    expect(store.getState().thumbnailsEnabled).toBe(false);
    store.getState().toggleThumbnailsEnabled();
    expect(store.getState().thumbnailsEnabled).toBe(true);
    store.getState().toggleThumbnailsEnabled();
    expect(store.getState().thumbnailsEnabled).toBe(false);
  });

  it('setThumbnailsEnabled: sets explicit value', () => {
    store.getState().setThumbnailsEnabled(true);
    expect(store.getState().thumbnailsEnabled).toBe(true);
    store.getState().setThumbnailsEnabled(false);
    expect(store.getState().thumbnailsEnabled).toBe(false);
  });

  it('toggleWaveformsEnabled: toggles state', () => {
    expect(store.getState().waveformsEnabled).toBe(false);
    store.getState().toggleWaveformsEnabled();
    expect(store.getState().waveformsEnabled).toBe(true);
    store.getState().toggleWaveformsEnabled();
    expect(store.getState().waveformsEnabled).toBe(false);
  });

  it('setWaveformsEnabled: sets explicit value', () => {
    store.getState().setWaveformsEnabled(true);
    expect(store.getState().waveformsEnabled).toBe(true);
    store.getState().setWaveformsEnabled(false);
    expect(store.getState().waveformsEnabled).toBe(false);
  });

  it('toggleTranscriptMarkers: toggles state', () => {
    expect(store.getState().showTranscriptMarkers).toBe(false);
    store.getState().toggleTranscriptMarkers();
    expect(store.getState().showTranscriptMarkers).toBe(true);
    store.getState().toggleTranscriptMarkers();
    expect(store.getState().showTranscriptMarkers).toBe(false);
  });

  it('setShowTranscriptMarkers: sets explicit value', () => {
    store.getState().setShowTranscriptMarkers(true);
    expect(store.getState().showTranscriptMarkers).toBe(true);
    store.getState().setShowTranscriptMarkers(false);
    expect(store.getState().showTranscriptMarkers).toBe(false);
  });

  // ─── RAM Preview state ────────────────────────────────────────────────

  it('toggleRamPreviewEnabled: enables when disabled', () => {
    expect(store.getState().ramPreviewEnabled).toBe(false);
    store.getState().toggleRamPreviewEnabled();
    expect(store.getState().ramPreviewEnabled).toBe(true);
  });

  it('toggleRamPreviewEnabled: disables and clears state', () => {
    store.getState().toggleRamPreviewEnabled(); // enable
    store.setState({ isRamPreviewing: true, ramPreviewProgress: 50 });
    store.getState().toggleRamPreviewEnabled(); // disable
    expect(store.getState().ramPreviewEnabled).toBe(false);
    expect(store.getState().isRamPreviewing).toBe(false);
    expect(store.getState().ramPreviewProgress).toBeNull();
    expect(store.getState().cachedFrameTimes.size).toBe(0);
  });

  it('cancelRamPreview: stops previewing and clears progress', () => {
    store.setState({ isRamPreviewing: true, ramPreviewProgress: 75 });
    store.getState().cancelRamPreview();
    expect(store.getState().isRamPreviewing).toBe(false);
    expect(store.getState().ramPreviewProgress).toBeNull();
  });

  it('cancelRamPreview: no-op when not previewing', () => {
    store.getState().cancelRamPreview();
    expect(store.getState().isRamPreviewing).toBe(false);
    expect(store.getState().ramPreviewProgress).toBeNull();
  });

  // ─── Cached frames ────────────────────────────────────────────────────

  it('addCachedFrame: adds quantized frame time to set', () => {
    store.getState().addCachedFrame(1.0);
    expect(store.getState().cachedFrameTimes.has(1.0)).toBe(true);
    expect(store.getState().cachedFrameTimes.size).toBe(1);
  });

  it('addCachedFrame: quantizes time to 30fps', () => {
    // 1/30 = 0.03333...
    store.getState().addCachedFrame(0.034);
    // Should be quantized to Math.round(0.034 * 30) / 30 = Math.round(1.02) / 30 = 1/30
    const quantized = Math.round(0.034 * 30) / 30;
    expect(store.getState().cachedFrameTimes.has(quantized)).toBe(true);
  });

  it('addCachedFrame: does not duplicate already-cached frame', () => {
    store.getState().addCachedFrame(1.0);
    store.getState().addCachedFrame(1.0);
    expect(store.getState().cachedFrameTimes.size).toBe(1);
  });

  it('addCachedFrame: multiple distinct times are stored', () => {
    store.getState().addCachedFrame(0.0);
    store.getState().addCachedFrame(1.0);
    store.getState().addCachedFrame(2.0);
    expect(store.getState().cachedFrameTimes.size).toBe(3);
  });

  it('getCachedRanges: returns empty for no cached frames', () => {
    const ranges = store.getState().getCachedRanges();
    expect(ranges).toEqual([]);
  });

  it('getCachedRanges: returns single range for contiguous frames', () => {
    // Add frames at 30fps intervals: 0, 1/30, 2/30
    const fps = 30;
    for (let i = 0; i < 3; i++) {
      store.getState().addCachedFrame(i / fps);
    }
    const ranges = store.getState().getCachedRanges();
    expect(ranges.length).toBe(1);
    expect(ranges[0].start).toBeCloseTo(0, 5);
    expect(ranges[0].end).toBeCloseTo(2 / fps + 1 / fps, 5);
  });

  it('getCachedRanges: splits into separate ranges for non-contiguous frames', () => {
    // Add frames with a gap larger than 2 frame intervals
    store.getState().addCachedFrame(0.0);
    store.getState().addCachedFrame(1 / 30);
    // Skip a bunch of frames (gap > 2/30)
    store.getState().addCachedFrame(5.0);
    store.getState().addCachedFrame(5.0 + 1 / 30);

    const ranges = store.getState().getCachedRanges();
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBeCloseTo(0, 5);
    expect(ranges[1].start).toBeCloseTo(5.0, 5);
  });

  // ─── Complex interaction scenarios ─────────────────────────────────────

  it('play then pause restores speed to 1', async () => {
    store.getState().setPlaybackSpeed(4);
    await store.getState().play();
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().playbackSpeed).toBe(4);
    store.getState().pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('setInPoint and setOutPoint maintain valid range', () => {
    store.getState().setInPoint(20);
    store.getState().setOutPoint(40);
    expect(store.getState().inPoint).toBe(20);
    expect(store.getState().outPoint).toBe(40);

    // Try to set in point beyond out point
    store.getState().setInPoint(50);
    expect(store.getState().inPoint).toBe(40);

    // Try to set out point below in point
    store.getState().setOutPoint(10);
    expect(store.getState().outPoint).toBe(40); // clamped to inPoint
  });

  it('setDuration with smaller value clamps all dependent state', () => {
    store.getState().setPlayheadPosition(55);
    store.getState().setInPoint(50);
    store.getState().setOutPoint(58);

    store.getState().setDuration(10);

    expect(store.getState().duration).toBe(10);
    expect(store.getState().playheadPosition).toBe(10);
    expect(store.getState().inPoint).toBe(10);
    expect(store.getState().outPoint).toBe(10);
  });

  it('JKL shuttle: J then K (pause) then L plays forward', async () => {
    // J starts reverse
    store.getState().playReverse();
    await new Promise(r => setTimeout(r, 0));
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().playbackSpeed).toBe(-1);

    // K pauses
    store.getState().pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().playbackSpeed).toBe(1);

    // L starts forward
    store.getState().playForward();
    await new Promise(r => setTimeout(r, 0));
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().playbackSpeed).toBe(1);
  });

  it('playForward while reverse playing switches direction to 1', () => {
    store.setState({ isPlaying: true, playbackSpeed: -4 });
    store.getState().playForward();
    expect(store.getState().playbackSpeed).toBe(1);
    expect(store.getState().isPlaying).toBe(true);
  });

  it('playReverse while forward playing switches direction to -1', () => {
    store.setState({ isPlaying: true, playbackSpeed: 4 });
    store.getState().playReverse();
    expect(store.getState().playbackSpeed).toBe(-1);
    expect(store.getState().isPlaying).toBe(true);
  });
});
