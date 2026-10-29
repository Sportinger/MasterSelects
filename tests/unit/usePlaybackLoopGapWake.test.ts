import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const hoisted = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  playheadState: {
    position: 0,
    isUsingInternalPosition: false,
    hasMasterAudio: false,
    masterAudioElement: null,
    masterAudioClock: null,
    heldPlaybackPosition: null,
    playbackJustStarted: false,
  },
  wakePositions: [] as number[],
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => hoisted.state,
    setState: (partial: Record<string, unknown>) => { Object.assign(hoisted.state, partial); },
  },
}));
vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    // Records where the playhead stood when the playback loop woke the render host.
    setTimelineVisualDemand: vi.fn(() => { hoisted.wakePositions.push(hoisted.playheadState.position); }),
    requestNewFrameRender: vi.fn(),
  },
}));
vi.mock('../../src/services/layerBuilder', () => ({
  clearInternalPlaybackHold: vi.fn(),
  getPlayheadPosition: (position: number) => position,
  layerBuilder: { syncAudioElements: vi.fn() },
  markPlayheadFrameHistoryDiscontinuity: vi.fn(),
  playheadState: hoisted.playheadState,
  startInternalPosition: (position: number) => {
    hoisted.playheadState.position = position;
    hoisted.playheadState.isUsingInternalPosition = true;
  },
  updateInternalPosition: (position: number) => { hoisted.playheadState.position = position; },
}));

import { usePlaybackLoop } from '../../src/components/timeline/hooks/usePlaybackLoop';

const tracks = [{ id: 'v1', type: 'video', visible: true }] as TimelineTrack[];
// Clip A [0, 2), a 3 s gap, clip B [5, 7), then 2 s of nothing up to the timeline end.
const clips = [
  { id: 'a', trackId: 'v1', startTime: 0, duration: 2 },
  { id: 'b', trackId: 'v1', startTime: 5, duration: 2 },
] as TimelineClip[];
const FRAME_MS = 1000 / 60;

describe('usePlaybackLoop gap wake', () => {
  let rafCallbacks: FrameRequestCallback[];
  let now: number;

  beforeEach(() => {
    rafCallbacks = [];
    now = 1000;
    hoisted.wakePositions.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCallbacks.push(cb); return rafCallbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const play = (playheadPosition: number, playbackSpeed: number, loopPlayback = false) => {
    hoisted.state = {
      playheadPosition, playbackSpeed, loopPlayback, clips, tracks,
      duration: 9, inPoint: null, outPoint: null, markers: [], clipDragPreview: null,
      isDraggingPlayhead: false, pause: vi.fn(),
    };
    return renderHook(() => usePlaybackLoop({ isPlaying: true }));
  };
  const runFrames = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += FRAME_MS;
      rafCallbacks.shift()!(now);
    }
  };

  it('wakes the render host on the frame the playhead enters the next clip', () => {
    const hook = play(3, 1);
    runFrames(100);
    expect(hoisted.wakePositions).toHaveLength(0);
    runFrames(30);
    expect(hoisted.wakePositions).toHaveLength(1);
    expect(hoisted.wakePositions[0]).toBeGreaterThan(5 - 1e-6);
    expect(hoisted.wakePositions[0]).toBeLessThan(5 + 1.01 / 60);
    hook.unmount();
  });

  it('wakes it when reverse playback enters the previous clip at its end', () => {
    const hook = play(3, -1);
    runFrames(50);
    expect(hoisted.wakePositions).toHaveLength(0);
    runFrames(20);
    expect(hoisted.wakePositions).toHaveLength(1);
    expect(hoisted.wakePositions[0]).toBeLessThan(2);
    expect(hoisted.wakePositions[0]).toBeGreaterThan(2 - 1.01 / 60);
    hook.unmount();
  });

  it('wakes it when a loop wrap jumps from a gap at the end into a clip', () => {
    const hook = play(8, 1, true);
    runFrames(55);
    expect(hoisted.wakePositions).toHaveLength(0);
    runFrames(10);
    expect(hoisted.wakePositions).toEqual([0]);
    hook.unmount();
  });
});
