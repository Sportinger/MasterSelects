import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPlaybackSlice } from '../../src/stores/timeline/playbackSlice';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import type { TimelineStore } from '../../src/stores/timeline/types';

const getRuntimeFrameProvider = vi.fn();
const requestNewFrameRender = vi.fn();

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      activeCompositionId: null,
      updateComposition: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  getRuntimeFrameProvider: (...args: unknown[]) => getRuntimeFrameProvider(...args),
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    requestNewFrameRender: (...args: unknown[]) => requestNewFrameRender(...args),
  },
}));

type PlaybackTestStore = Partial<TimelineStore> & ReturnType<typeof createPlaybackSlice>;

function createPlaybackTestStore(initialState: Partial<TimelineStore>): PlaybackTestStore {
  const state = { ...initialState } as PlaybackTestStore;
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
    playheadState.position = 0;
    playheadState.isUsingInternalPosition = false;
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

  it('requests a fresh render when moving the paused playhead without dragging', () => {
    const state = createPlaybackTestStore({
      clips: [],
      playheadPosition: 0,
      duration: 60,
      isPlaying: false,
      isDraggingPlayhead: false,
    } as Partial<TimelineStore>);

    state.setPlayheadPosition(1 / 30);

    expect(requestNewFrameRender).toHaveBeenCalledTimes(1);
  });
});
