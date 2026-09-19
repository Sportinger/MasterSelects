import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  buildPlaybackPathPreset,
  handleSimulateFrameKeypresses,
  handleSimulatePlayback,
} from '../../src/services/aiTools/handlers/playback';

function makePlaybackStore(options: {
  isPlaying?: boolean;
  playbackSpeed?: number;
  playImpl?: () => Promise<void>;
} = {}) {
  const store = {
    isPlaying: options.isPlaying ?? false,
    playbackSpeed: options.playbackSpeed ?? 1,
    duration: 60,
    pause: vi.fn(() => {
      store.isPlaying = false;
      useTimelineStore.setState({ isPlaying: false, playbackSpeed: 1 });
    }),
    play: vi.fn(async () => {
      if (options.playImpl) {
        await options.playImpl();
        return;
      }
      store.isPlaying = true;
      useTimelineStore.setState({ isPlaying: true });
    }),
    setPlaybackSpeed: vi.fn((speed: number) => {
      store.playbackSpeed = speed;
      useTimelineStore.setState({ playbackSpeed: speed });
    }),
    setDraggingPlayhead: vi.fn((isDraggingPlayhead: boolean) => {
      useTimelineStore.setState({ isDraggingPlayhead });
    }),
    setPlayheadPosition: vi.fn((playheadPosition: number) => {
      useTimelineStore.setState({ playheadPosition });
    }),
  };

  return store;
}

describe('AI simulatePlayback handler', () => {
  beforeEach(() => {
    const debugEngine = engine as unknown as {
      getLayerCollector?: () => { isVideoGpuReady: () => boolean };
    };
    debugEngine.getLayerCollector = () => ({
      isVideoGpuReady: () => false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const debugEngine = engine as unknown as {
      getLayerCollector?: unknown;
    };
    delete debugEngine.getLayerCollector;
    useTimelineStore.setState({
      duration: 60,
      isDraggingPlayhead: false,
      isPlaying: false,
      playbackSpeed: 1,
      playheadPosition: 0,
      playbackWarmup: null,
    });
  });

  it('honors string durationMs and ends paused by default even when playback was already running', async () => {
    useTimelineStore.setState({ duration: 60, isPlaying: true, playbackSpeed: 2, playheadPosition: 5 });
    const store = makePlaybackStore({ isPlaying: true, playbackSpeed: 2 });

    const result = await handleSimulatePlayback({
      durationMs: '100',
      settleMs: 0,
      resetDiagnostics: false,
    }, store as unknown as ReturnType<typeof useTimelineStore.getState>);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      requestedDurationMs: 100,
      wasPlaying: true,
      restoredPlaybackState: false,
      endedPlaying: false,
    });
    expect(store.play).toHaveBeenCalledTimes(1);
    expect(store.pause).toHaveBeenCalled();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('only resumes prior playback when restorePlaybackState is explicitly true', async () => {
    useTimelineStore.setState({ duration: 60, isPlaying: true, playbackSpeed: 1.5, playheadPosition: 5 });
    const store = makePlaybackStore({ isPlaying: true, playbackSpeed: 1.5 });

    const result = await handleSimulatePlayback({
      durationMs: 100,
      settleMs: 0,
      resetDiagnostics: false,
      restorePlaybackState: true,
    }, store as unknown as ReturnType<typeof useTimelineStore.getState>);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      requestedDurationMs: 100,
      restoredPlaybackState: true,
      endedPlaying: true,
    });
    expect(store.play).toHaveBeenCalledTimes(2);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
  });

  it('pauses playback if the simulated play run throws', async () => {
    const store = makePlaybackStore({
      playImpl: async () => {
        useTimelineStore.setState({ isPlaying: true });
        throw new Error('play failed');
      },
    });

    await expect(handleSimulatePlayback({
      durationMs: 100,
      settleMs: 0,
      resetDiagnostics: false,
    }, store as unknown as ReturnType<typeof useTimelineStore.getState>)).rejects.toThrow('play failed');

    expect(store.pause).toHaveBeenCalled();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('samples playback with timers instead of depending on debug-handler RAF cadence', async () => {
    // Advance the sampling clock deterministically: suite contention must not
    // turn the requested 100 ms run into one delayed timer callback.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const store = makePlaybackStore();

    const pending = handleSimulatePlayback({
      durationMs: 100,
      settleMs: 0,
      resetDiagnostics: false,
    }, store as unknown as ReturnType<typeof useTimelineStore.getState>);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.success).toBe(true);
    const data = result.data as {
      framesObserved: number;
      observedSampleFps: number;
    };
    expect(data.framesObserved).toBeGreaterThan(2);
    expect(data.observedSampleFps).toBeGreaterThan(10);
  });
});

describe('AI simulateFrameKeypresses handler', () => {
  beforeEach(() => {
    const debugEngine = engine as unknown as {
      getLayerCollector?: () => { isVideoGpuReady: () => boolean };
    };
    debugEngine.getLayerCollector = () => ({
      isVideoGpuReady: () => false,
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const debugEngine = engine as unknown as {
      getLayerCollector?: unknown;
    };
    delete debugEngine.getLayerCollector;
    useTimelineStore.setState({
      duration: 60,
      isDraggingPlayhead: false,
      isPlaying: false,
      playbackSpeed: 1,
      playheadPosition: 0,
      playbackWarmup: null,
    });
  });

  it('dispatches real ArrowLeft/ArrowRight keydown events through window listeners', async () => {
    const frameDuration = 1 / 60;
    let currentPosition = 6;
    useTimelineStore.setState({
      duration: 60,
      isPlaying: false,
      playheadPosition: currentPosition,
    });
    const listener = vi.fn((event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        currentPosition -= frameDuration;
        useTimelineStore.setState({ playheadPosition: currentPosition });
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        currentPosition += frameDuration;
        useTimelineStore.setState({ playheadPosition: currentPosition });
      }
    });
    window.addEventListener('keydown', listener);
    const store = makePlaybackStore();

    try {
      const result = await handleSimulateFrameKeypresses({
        sequence: ['ArrowLeft', 'ArrowLeft', 'ArrowRight'],
        delayMs: 0,
        settleMs: 0,
        resetDiagnostics: false,
      }, store as unknown as ReturnType<typeof useTimelineStore.getState>);

      expect(result.success).toBe(true);
      expect(listener).toHaveBeenCalledTimes(3);
      expect(store.pause).toHaveBeenCalled();
      expect(result.data).toMatchObject({
        keyCount: 3,
        sequence: ['ArrowLeft', 'ArrowLeft', 'ArrowRight'],
      });
      const data = result.data as { samples: Array<Record<string, unknown>>; finalPosition: number };
      expect(data.samples.map((sample) => sample.key)).toEqual(['ArrowLeft', 'ArrowLeft', 'ArrowRight']);
      expect(data.samples.every((sample) => sample.defaultPrevented === true)).toBe(true);
      expect(data.finalPosition).toBeCloseTo(6 - frameDuration, 8);
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });
});

describe('AI simulatePlaybackPath preset planning', () => {
  it('keeps the 3 minute stress scrub inside the playable video range', () => {
    const steps = buildPlaybackPathPreset('play_scrub_stress_v1', {
      clipStartTime: 0,
      playableEndTime: 159.567,
    });
    const threeMinuteScrub = steps.find((step) => step.label === 'scrub_while_playing_to_3m_in_2s');

    expect(threeMinuteScrub).toMatchObject({
      kind: 'scrub',
      unclampedTargetTime: 180,
      targetTime: 157.067,
    });
  });

  it('leaves the long jump unclamped when enough playable media remains', () => {
    const steps = buildPlaybackPathPreset('play_scrub_stress_v1', {
      clipStartTime: 0,
      playableEndTime: 300,
    });
    const threeMinuteScrub = steps.find((step) => step.label === 'scrub_while_playing_to_3m_in_2s');

    expect(threeMinuteScrub).toMatchObject({
      kind: 'scrub',
      unclampedTargetTime: 180,
      targetTime: 180,
    });
  });
});
