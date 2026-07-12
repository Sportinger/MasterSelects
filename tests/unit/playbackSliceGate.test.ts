import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createPlaybackSlice } from '../../src/stores/timeline/playbackSlice';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import type { TimelineStore } from '../../src/stores/timeline/types';

const getRuntimeFrameProvider = vi.fn();
const requestNewFrameRender = vi.fn();
const primeReverseWorkerRuntimeSourcesForPlayback = vi.hoisted(() => vi.fn().mockResolvedValue(0));

const mediaStoreMock = vi.hoisted(() => ({
  sourceMonitorFileId: null as string | null,
  setSourceMonitorFile: vi.fn(),
  updateComposition: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      activeCompositionId: null,
      sourceMonitorFileId: mediaStoreMock.sourceMonitorFileId,
      setSourceMonitorFile: mediaStoreMock.setSourceMonitorFile,
      updateComposition: mediaStoreMock.updateComposition,
    }),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  getRuntimeFrameProvider: (...args: unknown[]) => getRuntimeFrameProvider(...args),
}));

vi.mock('../../src/services/layerBuilder/reverseWorkerWebCodecsRuntime', () => ({
  primeReverseWorkerRuntimeSourcesForPlayback,
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    requestNewFrameRender: (...args: unknown[]) => requestNewFrameRender(...args),
    setIsPlaying: vi.fn(),
  },
}));

type PlaybackTestStore = Partial<TimelineStore> & ReturnType<typeof createPlaybackSlice>;

function createPlaybackTestStore(initialState: Partial<TimelineStore>): PlaybackTestStore {
  const state = {
    clips: [],
    tracks: [],
    markers: [],
    clipDragPreview: null,
    ...initialState,
  } as PlaybackTestStore;
  const set: Parameters<typeof createPlaybackSlice>[0] = (partial) => {
    const next = typeof partial === 'function' ? partial(state as TimelineStore) : partial;
    Object.assign(state, next);
  };
  const get: Parameters<typeof createPlaybackSlice>[1] = () => state as TimelineStore;
  Object.assign(state, createPlaybackSlice(set, get));
  return state;
}

describe('playbackSlice HTML readiness gate', () => {
  beforeEach(() => {
    getRuntimeFrameProvider.mockReset();
    requestNewFrameRender.mockReset();
    primeReverseWorkerRuntimeSourcesForPlayback.mockReset();
    primeReverseWorkerRuntimeSourcesForPlayback.mockResolvedValue(0);
    mediaStoreMock.sourceMonitorFileId = null;
    mediaStoreMock.setSourceMonitorFile.mockReset();
    mediaStoreMock.setSourceMonitorFile.mockImplementation((id: string | null) => {
      mediaStoreMock.sourceMonitorFileId = id;
    });
    mediaStoreMock.updateComposition.mockReset();
    playheadState.position = 0;
    playheadState.isUsingInternalPosition = false;
    playheadState.playbackJustStarted = false;
    playheadState.hasMasterAudio = false;
    playheadState.masterAudioElement = null;
    playheadState.masterAudioClock = null;
    playheadState.heldPlaybackPosition = null;
    playheadState.heldPlaybackClipId = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips HTML readiness warmup for full WebCodecs clips', async () => {
    const htmlVideo = {
      readyState: 0,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    const fullModeProvider = {
      isFullMode: () => true,
    };

    getRuntimeFrameProvider.mockReturnValue(fullModeProvider);

    const state = createPlaybackTestStore({
      clips: [
        {
          id: 'clip-1',
          startTime: 0,
          duration: 10,
          source: {
            videoElement: htmlVideo,
            webCodecsPlayer: fullModeProvider,
          },
        },
      ],
      playheadPosition: 1,
      duration: 60,
      isPlaying: false,
    } as Partial<TimelineStore>);

    await state.play();

    expect(state.isPlaying).toBe(true);
    expect(htmlVideo.play).not.toHaveBeenCalled();
    expect(htmlVideo.pause).not.toHaveBeenCalled();
  }, 10_000);

  it('primes a negative source-map rate at playback start without treating positive maps as reverse', async () => {
    const video = { readyState: 4 } as HTMLVideoElement;
    const createState = (sourceEnd: number) => createPlaybackTestStore({
      clips: [{
        id: `mapped-${sourceEnd}`,
        trackId: 'video-1',
        startTime: 0,
        duration: 2,
        source: { type: 'video', videoElement: video },
        transitionSourceMap: {
          version: 1,
          segments: [{ kind: 'linear', compStart: 0, compEnd: 2, sourceStart: 10, sourceEnd }],
        },
      }],
      tracks: [{ id: 'video-1', type: 'video', visible: true }],
      playheadPosition: 0,
      duration: 60,
      isPlaying: false,
    } as Partial<TimelineStore>);

    await createState(4).play();
    expect(primeReverseWorkerRuntimeSourcesForPlayback).toHaveBeenCalledWith(expect.objectContaining({
      playheadPosition: 0,
      playbackSpeed: 1,
    }));

    primeReverseWorkerRuntimeSourcesForPlayback.mockClear();
    await createState(16).play();
    expect(primeReverseWorkerRuntimeSourcesForPlayback).not.toHaveBeenCalled();
  });

  it('exposes playback warmup state while HTML video readiness is pending', async () => {
    vi.useFakeTimers();
    getRuntimeFrameProvider.mockReturnValue(null);

    const htmlVideo = {
      readyState: 0,
      play: vi.fn(),
      pause: vi.fn(),
    };
    htmlVideo.play.mockImplementation(() => {
      htmlVideo.readyState = 3;
      return Promise.resolve();
    });

    const state = createPlaybackTestStore({
      clips: [
        {
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          source: {
            videoElement: htmlVideo,
          },
        },
      ],
      tracks: [{ id: 'video-1', type: 'video', visible: true }],
      playheadPosition: 1,
      duration: 60,
      isPlaying: false,
      playbackWarmup: null,
    } as Partial<TimelineStore>);

    const playPromise = state.play();

    expect(state.isPlaying).toBe(false);
    expect(state.playbackWarmup).toMatchObject({
      targetTime: 1,
      pendingVideoCount: 1,
      totalVideoCount: 1,
    });

    await vi.advanceTimersByTimeAsync(60);
    await playPromise;

    expect(state.playbackWarmup).toBeNull();
    expect(state.isPlaying).toBe(true);
    expect(htmlVideo.pause).toHaveBeenCalled();
  });

  it('does not start playback when a pending warmup was canceled', async () => {
    vi.useFakeTimers();
    getRuntimeFrameProvider.mockReturnValue(null);

    const htmlVideo = {
      readyState: 0,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    };

    const state = createPlaybackTestStore({
      clips: [
        {
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          source: {
            videoElement: htmlVideo,
          },
        },
      ],
      tracks: [{ id: 'video-1', type: 'video', visible: true }],
      playheadPosition: 1,
      duration: 60,
      isPlaying: false,
      playbackWarmup: null,
    } as Partial<TimelineStore>);

    const playPromise = state.play();
    expect(state.playbackWarmup).not.toBeNull();

    state.pause();
    htmlVideo.readyState = 3;
    await vi.advanceTimersByTimeAsync(60);
    await playPromise;

    expect(state.playbackWarmup).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  it('keeps the internal playhead in sync when moving the playhead while paused', () => {
    const state = createPlaybackTestStore({
      clips: [],
      playheadPosition: null,
      duration: 60,
      isPlaying: false,
    } as Partial<TimelineStore>);

    playheadState.position = 4.1;
    playheadState.isUsingInternalPosition = true;

    state.setPlayheadPosition(20);

    expect(state.playheadPosition).toBe(20);
    expect(playheadState.position).toBe(20);
  });

  it('closes the source monitor when timeline playback starts', async () => {
    mediaStoreMock.sourceMonitorFileId = 'image-source';

    const state = createPlaybackTestStore({
      clips: [],
      playheadPosition: 0,
      duration: 60,
      isPlaying: false,
      playbackWarmup: null,
    } as Partial<TimelineStore>);

    await state.play();

    expect(state.isPlaying).toBe(true);
    expect(mediaStoreMock.setSourceMonitorFile).toHaveBeenCalledWith(null);
    expect(mediaStoreMock.sourceMonitorFileId).toBeNull();
  });

  it('stop clears the internal playhead clock before resetting to the stop target', () => {
    const audio = {} as HTMLAudioElement;
    const state = createPlaybackTestStore({
      clips: [],
      playheadPosition: 23,
      duration: 60,
      inPoint: 7,
      isPlaying: true,
      playbackWarmup: { requestId: 'warmup', startedAt: 0, targetTime: 23, pendingVideoCount: 0, totalVideoCount: 0 },
    } as Partial<TimelineStore>);

    playheadState.position = 23;
    playheadState.isUsingInternalPosition = true;
    playheadState.playbackJustStarted = true;
    playheadState.hasMasterAudio = true;
    playheadState.masterAudioElement = audio;
    playheadState.heldPlaybackPosition = 23;
    playheadState.heldPlaybackClipId = 'clip-1';

    state.stop();

    expect(state.isPlaying).toBe(false);
    expect(state.playheadPosition).toBe(7);
    expect(state.playbackWarmup).toBeNull();
    expect(playheadState.position).toBe(7);
    expect(playheadState.isUsingInternalPosition).toBe(false);
    expect(playheadState.playbackJustStarted).toBe(false);
    expect(playheadState.hasMasterAudio).toBe(false);
    expect(playheadState.masterAudioElement).toBeNull();
    expect(playheadState.heldPlaybackPosition).toBeNull();
  });

  it('requests a fresh render when moving the paused playhead without dragging', () => {
    const state = createPlaybackTestStore({
      clips: [
        {
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
        },
      ],
      tracks: [
        {
          id: 'video-1',
          type: 'video',
          visible: true,
        },
      ],
      playheadPosition: 0,
      duration: 60,
      isPlaying: false,
      isDraggingPlayhead: false,
    } as Partial<TimelineStore>);

    state.setPlayheadPosition(1 / 30);

    expect(requestNewFrameRender).toHaveBeenCalledTimes(1);
  });
});
