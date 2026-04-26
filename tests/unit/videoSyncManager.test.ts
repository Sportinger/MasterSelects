import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { flags } from '../../src/engine/featureFlags';
import { VideoSyncManager } from '../../src/services/layerBuilder/VideoSyncManager';
import { scrubSettleState } from '../../src/services/scrubSettleState';

type EngineTestAccess = typeof engine & {
  ensureVideoFrameCached: ReturnType<typeof vi.fn>;
  getLastPresentedVideoTime: ReturnType<typeof vi.fn>;
  requestNewFrameRender: ReturnType<typeof vi.fn>;
  cacheFrameAtTime: ReturnType<typeof vi.fn>;
  markVideoFramePresented: ReturnType<typeof vi.fn>;
  captureVideoFrameAtTime: ReturnType<typeof vi.fn>;
  markVideoGpuReady: ReturnType<typeof vi.fn>;
  requestRender: ReturnType<typeof vi.fn>;
};

type VideoSyncManagerTestAccess = {
  computeHandoffs: (...args: unknown[]) => unknown;
  getHandoffVideoElement: (...args: unknown[]) => unknown;
  getPausedWebCodecsProvider: (...args: unknown[]) => unknown;
  getPreviewContinuationVideoElement: (...args: unknown[]) => unknown;
  isPlaybackProviderReadyForAudioStart: (...args: unknown[]) => boolean;
  isVideoWarmingUp: (...args: unknown[]) => boolean;
  maybeRetargetActiveWarmup: (...args: unknown[]) => void;
  preloadPausedJumpNeighborhood: (...args: unknown[]) => void;
  schedulePreciseWcSeek: (...args: unknown[]) => void;
  shouldCorrectPlaybackAudioDrift: (...args: unknown[]) => boolean;
  shouldFastSeekPausedWebCodecsProvider: (...args: unknown[]) => boolean;
  shouldHoldScrubReleaseIntoPlayback: (...args: unknown[]) => boolean;
  shouldSeekPausedWebCodecsProvider: (...args: unknown[]) => boolean;
  startTargetedWarmup: (...args: unknown[]) => void;
  syncClipVideo: (...args: unknown[]) => void;
  syncFullWebCodecs: (...args: unknown[]) => void;
  syncPausedWebCodecsProvider: (...args: unknown[]) => void;
  throttledSeek: (...args: unknown[]) => void;
  lastTrackState: Map<string, unknown>;
  lastWcFastSeekAt: Record<string, number>;
  lastWcFastSeekTarget: Record<string, number>;
  lastWcPreciseSeekAt: Record<string, number>;
  latestSeekTargets: Record<string, number>;
  pendingSeekStartedAt: Record<string, number>;
  pendingSeekTargets: Record<string, number>;
  preciseSeekTimers: Record<string, ReturnType<typeof setTimeout>>;
  queuedSeekTargets: Record<string, number>;
  rvfcHandles: Record<string, number>;
  seekedFlushArmed: Set<string>;
  warmingUpVideos: WeakSet<object>;
  warmupClipIds: WeakMap<object, string>;
  warmupTargetTimes: WeakMap<object, number>;
};

const testEngine = engine as EngineTestAccess;
const createManager = (): VideoSyncManagerTestAccess => new VideoSyncManager() as unknown as VideoSyncManagerTestAccess;

describe('VideoSyncManager paused WebCodecs provider selection', () => {
  beforeEach(() => {
    vi.useRealTimers();
    flags.useFullWebCodecsPlayback = true;
    scrubSettleState.clear();
    testEngine.ensureVideoFrameCached = vi.fn();
    testEngine.getLastPresentedVideoTime = vi.fn(() => undefined);
    testEngine.requestNewFrameRender = vi.fn();
    testEngine.cacheFrameAtTime = vi.fn();
    testEngine.markVideoFramePresented = vi.fn();
    testEngine.captureVideoFrameAtTime = vi.fn(() => false);
    testEngine.markVideoGpuReady = vi.fn();
    testEngine.requestRender = vi.fn();
  });

  it('keeps driving the clip player while the scrub runtime is still cold', () => {
    const manager = createManager();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      currentTime: 1,
    };
    const scrubProvider = {
      isFullMode: () => true,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      currentTime: 1.02,
      getPendingSeekTime: () => 1.02,
    };

    const provider = manager.getPausedWebCodecsProvider(
      { webCodecsPlayer: clipPlayer },
      scrubProvider,
      1.01
    );

    expect(provider).toBe(clipPlayer);
  });

  it('switches to the scrub runtime once it has a frame near the target', () => {
    const manager = createManager();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 900_000 }),
      currentTime: 0.9,
    };
    const scrubProvider = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      currentTime: 1.01,
      getPendingSeekTime: () => 1.01,
    };

    const provider = manager.getPausedWebCodecsProvider(
      { webCodecsPlayer: clipPlayer },
      scrubProvider,
      1.01
    );

    expect(provider).toBe(scrubProvider);
  });

  it('prefers the shared runtime when its frame is closer to the paused target than the clip player', () => {
    const manager = createManager();
    const clipPlayer = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 22_589_233 }),
      currentTime: 22.589233,
    };
    const sharedRuntimeProvider = {
      isFullMode: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 8_700_000 }),
      currentTime: 8.7,
      getPendingSeekTime: () => 8.7,
    };

    const provider = manager.getPausedWebCodecsProvider(
      { webCodecsPlayer: clipPlayer },
      sharedRuntimeProvider,
      8.68
    );

    expect(provider).toBe(sharedRuntimeProvider);
  });

  it('forces a paused seek when the provider is already at the target time but still has no frame', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1)).toBe(true);
  });

  it('does not force a paused seek when the provider already has a frame at the target time', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1)).toBe(false);
  });

  it('does seek on a single-frame paused step instead of waiting for a larger drift window', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1 + 1 / 30)).toBe(true);
  });

  it('re-seeks when a paused pending target went stale without producing a frame', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => 1,
      isDecodePending: () => false,
    };

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1)).toBe(true);
  });

  it('does not re-seek while the same paused seek target is still actively decoding', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => 1,
      isDecodePending: () => true,
    };

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1)).toBe(false);
  });

  it('does not immediately re-seek a fresh paused precise seek that is still settling', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => 1,
      isDecodePending: () => false,
    };

    manager.lastWcPreciseSeekAt['clip:fallback'] = performance.now();

    expect(manager.shouldSeekPausedWebCodecsProvider(provider, 1, 'clip:fallback')).toBe(false);
  });

  it('blocks audio start until the playback provider has a frame at the target', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => 1,
    };

    expect(manager.isPlaybackProviderReadyForAudioStart(provider, 1)).toBe(false);
  });

  it('allows audio start once the playback provider has a frame near the target', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1.01,
      hasFrame: () => true,
      hasBufferedFutureFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_010_000 }),
      getPendingSeekTime: () => 1.01,
    };

    expect(manager.isPlaybackProviderReadyForAudioStart(provider, 1.01)).toBe(true);
  });

  it('blocks audio start until a future playback frame is buffered', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1.01,
      hasFrame: () => true,
      hasBufferedFutureFrame: () => false,
      getCurrentFrame: () => ({ timestamp: 1_010_000 }),
      getPendingSeekTime: () => 1.01,
    };

    expect(manager.isPlaybackProviderReadyForAudioStart(provider, 1.01)).toBe(false);
  });

  it('does not correct playback audio drift until the audio element has actually started', () => {
    const manager = createManager();
    const audioElement = {
      paused: false,
      readyState: 4,
      played: { length: 0 },
    };

    expect(manager.shouldCorrectPlaybackAudioDrift(audioElement, true, false)).toBe(false);
  });

  it('corrects playback audio drift once the audio element has an active played range', () => {
    const manager = createManager();
    const audioElement = {
      paused: false,
      readyState: 4,
      played: { length: 1 },
    };

    expect(manager.shouldCorrectPlaybackAudioDrift(audioElement, true, false)).toBe(true);
  });

  it('allows a new fast seek when a busy scrub provider is stale and the target moved', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => true,
    };

    manager.lastWcFastSeekTarget['clip:scrub'] = 1;
    manager.lastWcFastSeekAt['clip:scrub'] = performance.now() - 220;

    expect(manager.shouldFastSeekPausedWebCodecsProvider(provider, 'clip:scrub', 1.4)).toBe(true);
  });

  it('keeps fast seek blocked while the current busy decode is still fresh', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => true,
    };

    manager.lastWcFastSeekTarget['clip:scrub'] = 1;
    manager.lastWcFastSeekAt['clip:scrub'] = performance.now() - 20;

    expect(manager.shouldFastSeekPausedWebCodecsProvider(provider, 'clip:scrub', 1.4)).toBe(false);
  });

  it('debounces precise scrub seeks while keeping the latest target', async () => {
    vi.useFakeTimers();

    const manager = createManager();
    const provider = {
      currentTime: 1,
      seek: vi.fn(),
    };

    manager.schedulePreciseWcSeek('clip:scrub', provider, 1.2);
    await vi.advanceTimersByTimeAsync(60);
    manager.schedulePreciseWcSeek('clip:scrub', provider, 1.6);

    await vi.advanceTimersByTimeAsync(70);

    expect(provider.seek).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60);

    expect(provider.seek).toHaveBeenCalledTimes(1);
    expect(provider.seek).toHaveBeenCalledWith(1.6);
  });

  it('uses a direct precise seek during drag for nearby forward targets', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      seek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    manager.syncPausedWebCodecsProvider(provider, 'clip:scrub', 1.18, true, true);

    expect(provider.seek).toHaveBeenCalledWith(1.18);
    expect(provider.fastSeek).not.toHaveBeenCalled();
  });

  it('uses scrubSeek during drag when the provider exposes an interactive scrub path', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    manager.syncPausedWebCodecsProvider(provider, 'clip:scrub', 0.76, true, true);

    expect(provider.scrubSeek).toHaveBeenCalledWith(0.76);
    expect(provider.seek).not.toHaveBeenCalled();
    expect(provider.fastSeek).not.toHaveBeenCalled();
  });

  it('keeps dedicated scrub providers on scrubSeek even for larger drag jumps', () => {
    const manager = createManager();
    const provider = {
      currentTime: 30,
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 30_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    manager.syncPausedWebCodecsProvider(provider, 'clip:scrub', 34.4, true, true);

    expect(provider.scrubSeek).toHaveBeenCalledWith(34.4);
    expect(provider.seek).not.toHaveBeenCalled();
    expect(provider.fastSeek).not.toHaveBeenCalled();
  });

  it('retargets a busy interactive scrub when the drag has moved far enough and the throttle window passed', () => {
    const manager = createManager();
    const provider = {
      currentTime: 30,
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 30_000_000 }),
      getPendingSeekTime: () => 30,
      isDecodePending: () => true,
    };

    manager.lastWcPreciseSeekAt['clip:scrub'] = performance.now() - 120;

    manager.syncPausedWebCodecsProvider(provider, 'clip:scrub', 34.4, true, false);

    expect(provider.scrubSeek).toHaveBeenCalledWith(34.4);
    expect(provider.fastSeek).not.toHaveBeenCalled();
    expect(provider.seek).not.toHaveBeenCalled();
  });

  it('does not spam busy interactive scrub retargets before the throttle window elapses', () => {
    const manager = createManager();
    const provider = {
      currentTime: 30,
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 30_000_000 }),
      getPendingSeekTime: () => 30,
      isDecodePending: () => true,
    };

    manager.lastWcPreciseSeekAt['clip:scrub'] = performance.now() - 20;

    manager.syncPausedWebCodecsProvider(provider, 'clip:scrub', 34.4, true, false);

    expect(provider.scrubSeek).not.toHaveBeenCalled();
    expect(provider.fastSeek).not.toHaveBeenCalled();
    expect(provider.seek).not.toHaveBeenCalled();
  });

  it('primes large paused teleports with a fast seek before the exact seek settles', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      seek: vi.fn(),
      scrubSeek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    manager.syncPausedWebCodecsProvider(provider, 'clip:manual', 5, false, false);

    expect(provider.fastSeek).toHaveBeenCalledWith(5);
    expect(provider.seek).not.toHaveBeenCalled();
    expect(provider.scrubSeek).not.toHaveBeenCalled();
  });

  it('holds playback handoff while the scrub-stop frame is still pending', () => {
    const manager = createManager();
    const provider = {
      currentTime: 29.2,
      getPendingSeekTime: () => 30,
      isDecodePending: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 29_200_000 }),
    };

    scrubSettleState.begin('clip-1', 30, 500, 'scrub-stop');

    expect(
      manager.shouldHoldScrubReleaseIntoPlayback('clip-1', provider, 30)
    ).toBe(true);
    expect(scrubSettleState.isPending('clip-1')).toBe(true);
  });

  it('also holds playback handoff while a manual seek frame is still pending', () => {
    const manager = createManager();
    const provider = {
      currentTime: 119.2,
      getPendingSeekTime: () => 120,
      isDecodePending: () => true,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 119_200_000 }),
    };

    scrubSettleState.begin('clip-1', 120, 500, 'manual-seek');

    expect(
      manager.shouldHoldScrubReleaseIntoPlayback('clip-1', provider, 120)
    ).toBe(true);
    expect(scrubSettleState.isPending('clip-1')).toBe(true);
  });

  it('releases playback handoff once the exact scrub-stop frame is visible and decoded', () => {
    const manager = createManager();
    const provider = {
      currentTime: 30,
      getPendingSeekTime: () => 30,
      isDecodePending: () => false,
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 30_000_000 }),
    };

    scrubSettleState.begin('clip-1', 30, 500, 'scrub-stop');

    expect(
      manager.shouldHoldScrubReleaseIntoPlayback('clip-1', provider, 30)
    ).toBe(false);
    expect(scrubSettleState.isPending('clip-1')).toBe(false);
  });

  it('keeps the fallback provider on fast seek only while a dedicated scrub provider warms up', () => {
    const manager = createManager();
    const provider = {
      currentTime: 1,
      seek: vi.fn(),
      fastSeek: vi.fn(),
      hasFrame: () => true,
      getCurrentFrame: () => ({ timestamp: 1_000_000 }),
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
    };

    manager.syncPausedWebCodecsProvider(provider, 'clip:fallback', 1.18, true, false, false);

    expect(provider.seek).not.toHaveBeenCalled();
    expect(provider.fastSeek).toHaveBeenCalledWith(1.18);
  });

  it('routes full WebCodecs clips through dedicated WebCodecs sync while dragging', () => {
    const manager = createManager();
    const syncFullWebCodecs = vi.spyOn(manager, 'syncFullWebCodecs').mockImplementation(() => {});
    const throttledSeek = vi.spyOn(manager, 'throttledSeek').mockImplementation(() => {});

    const video = {
      currentTime: 0,
      paused: true,
      seeking: false,
      readyState: 4,
      played: { length: 1 },
      pause: vi.fn(),
    };

    manager.syncClipVideo({
      id: 'clip-1',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      reversed: false,
      source: {
        videoElement: video,
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    }, {
      isPlaying: false,
      isDraggingPlayhead: true,
      playbackSpeed: 1,
      now: 1000,
      playheadPosition: 1.5,
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 1.5,
    });

    expect(syncFullWebCodecs).toHaveBeenCalledTimes(1);
    expect(throttledSeek).not.toHaveBeenCalled();
  });

  it('routes full WebCodecs clips through HTML sync logic when preview WebCodecs is disabled', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const syncFullWebCodecs = vi.spyOn(manager, 'syncFullWebCodecs');
    const throttledSeek = vi.spyOn(manager, 'throttledSeek').mockImplementation(() => {});

    const video = {
      currentTime: 0,
      paused: true,
      seeking: false,
      readyState: 4,
      played: { length: 1 },
      pause: vi.fn(),
      playbackRate: 1,
    };

    manager.syncClipVideo({
      id: 'clip-2',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      reversed: false,
      source: {
        videoElement: video,
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    }, {
      isPlaying: false,
      isDraggingPlayhead: false,
      playbackSpeed: 1,
      now: 1000,
      playheadPosition: 1.5,
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 1.5,
    });

    expect(syncFullWebCodecs).not.toHaveBeenCalled();
    expect(throttledSeek).toHaveBeenCalled();
  });

  it('pre-captures paused HTML frames with the active clip id as owner', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const ensureVideoFrameCached = testEngine.ensureVideoFrameCached;

    const video = {
      currentTime: 1.5,
      paused: true,
      seeking: false,
      readyState: 4,
      played: { length: 1 },
      pause: vi.fn(),
      playbackRate: 1,
    };

    manager.syncClipVideo({
      id: 'clip-owner',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      reversed: false,
      source: {
        videoElement: video,
      },
    }, {
      isPlaying: false,
      isDraggingPlayhead: true,
      playbackSpeed: 1,
      now: 1000,
      playheadPosition: 1.5,
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 1.5,
    });

    expect(ensureVideoFrameCached).toHaveBeenCalledWith(video, 'clip-owner');
  });

  it('rate-limits drag precise seeks when fastSeek is unavailable', () => {
    const manager = createManager();

    let currentTime = 0;
    const assignedSeekTimes: number[] = [];
    const video = {
      duration: 10,
      seeking: false,
      addEventListener: vi.fn(),
    };

    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        assignedSeekTimes.push(value);
        currentTime = value;
      },
    });

    manager.throttledSeek('clip-html', video, 1.5, {
      isDraggingPlayhead: true,
      now: 1000,
    });

    manager.throttledSeek('clip-html', video, 2.0, {
      isDraggingPlayhead: true,
      now: 1040,
    });

    expect(assignedSeekTimes).toEqual([1.5]);
  });

  it('preloads the paused jump neighborhood after a large paused seek', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const startTargetedWarmup = vi
      .spyOn(manager, 'startTargetedWarmup')
      .mockImplementation(() => {});

    const video = {
      currentTime: 0,
      readyState: 4,
      seeking: false,
      preload: 'metadata',
      src: 'file:///jump.mp4',
      currentSrc: 'file:///jump.mp4',
    };

    manager.preloadPausedJumpNeighborhood({
      isPlaying: false,
      isDraggingPlayhead: false,
      playheadPosition: 5,
      clips: [{
        id: 'clip-jump',
        trackId: 'track-v1',
        startTime: 0,
        inPoint: 0,
        outPoint: 10,
        duration: 10,
        source: {
          videoElement: video,
        },
      }],
      clipsAtTime: [{
        id: 'clip-jump',
        trackId: 'track-v1',
        startTime: 0,
        inPoint: 0,
        outPoint: 10,
        duration: 10,
        source: {
          videoElement: video,
        },
      }],
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 5,
    });

    expect(startTargetedWarmup).toHaveBeenCalledWith('clip-jump', video, 5, {
      proactive: true,
      requestRender: true,
    });
  });

  it('does not spam paused jump preload for the same paused target', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const startTargetedWarmup = vi
      .spyOn(manager, 'startTargetedWarmup')
      .mockImplementation(() => {});

    const video = {
      currentTime: 0,
      readyState: 4,
      seeking: false,
      preload: 'metadata',
      src: 'file:///jump.mp4',
      currentSrc: 'file:///jump.mp4',
    };

    const ctx = {
      isPlaying: false,
      isDraggingPlayhead: false,
      playheadPosition: 5,
      clips: [{
        id: 'clip-jump',
        trackId: 'track-v1',
        startTime: 0,
        inPoint: 0,
        outPoint: 10,
        duration: 10,
        source: {
          videoElement: video,
        },
      }],
      clipsAtTime: [{
        id: 'clip-jump',
        trackId: 'track-v1',
        startTime: 0,
        inPoint: 0,
        outPoint: 10,
        duration: 10,
        source: {
          videoElement: video,
        },
      }],
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 5,
    };

    manager.preloadPausedJumpNeighborhood(ctx);
    manager.preloadPausedJumpNeighborhood(ctx);

    expect(startTargetedWarmup).toHaveBeenCalledTimes(1);
  });

  it('aborts a stuck targeted warmup when no frame arrives', async () => {
    vi.useFakeTimers();

    const manager = createManager();
    const video = {
      currentTime: 1,
      readyState: 1,
      preload: 'metadata',
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      requestVideoFrameCallback: vi.fn(() => 1),
    };

    manager.startTargetedWarmup('clip-warm', video, 1);
    await vi.runAllTicks();

    expect(manager.isVideoWarmingUp(video)).toBe(true);

    await vi.advanceTimersByTimeAsync(950);

    expect(manager.isVideoWarmingUp(video)).toBe(false);
    expect(testEngine.markVideoGpuReady).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
  });

  it('falls back to finishing warmup when the target frame is already ready', async () => {
    vi.useFakeTimers();

    const manager = createManager();
    const video = {
      currentTime: 1,
      readyState: 4,
      preload: 'metadata',
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      requestVideoFrameCallback: vi.fn(() => 1),
    };

    manager.startTargetedWarmup('clip-warm', video, 1);
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(950);

    expect(manager.isVideoWarmingUp(video)).toBe(false);
    expect(testEngine.markVideoGpuReady).toHaveBeenCalledWith(video);
    expect(testEngine.cacheFrameAtTime).toHaveBeenCalledWith(video, 1);
  });

  it('clears in-flight HTML seek state before starting a targeted warmup', async () => {
    vi.useFakeTimers();

    const manager = createManager();
    const video = {
      currentTime: 1,
      readyState: 1,
      preload: 'metadata',
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      requestVideoFrameCallback: vi.fn(() => 3),
      cancelVideoFrameCallback: vi.fn(),
    };

    manager.rvfcHandles['clip-warm'] = 7;
    manager.pendingSeekTargets['clip-warm'] = 2.4;
    manager.pendingSeekStartedAt['clip-warm'] = 123;
    manager.queuedSeekTargets['clip-warm'] = 2.8;
    manager.latestSeekTargets['clip-warm'] = 3.1;
    manager.seekedFlushArmed.add('clip-warm');
    manager.preciseSeekTimers['clip-warm'] = setTimeout(() => {}, 5000);

    manager.startTargetedWarmup('clip-warm', video, 1.5);
    await vi.runAllTicks();

    expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
    expect(manager.pendingSeekTargets['clip-warm']).toBeUndefined();
    expect(manager.pendingSeekStartedAt['clip-warm']).toBeUndefined();
    expect(manager.queuedSeekTargets['clip-warm']).toBeUndefined();
    expect(manager.latestSeekTargets['clip-warm']).toBeUndefined();
    expect(manager.preciseSeekTimers['clip-warm']).toBeUndefined();
    expect(manager.seekedFlushArmed.has('clip-warm')).toBe(false);
  });

  it('retargets an active warmup when the paused scrub target jumps far away', () => {
    const manager = createManager();
    const video = {
      pause: vi.fn(),
    };

    manager.warmingUpVideos.add(video);
    manager.warmupClipIds.set(video, 'clip-warm');
    manager.warmupTargetTimes.set(video, 1);

    const clearWarmupState = vi
      .spyOn(manager, 'clearWarmupState')
      .mockImplementation(() => {});
    const startTargetedWarmup = vi
      .spyOn(manager, 'startTargetedWarmup')
      .mockImplementation(() => {});

    manager.maybeRetargetActiveWarmup('clip-warm', video, 2.25, 1000, {
      isPlaying: false,
      isDragging: true,
      requestRender: true,
    });

    expect(clearWarmupState).toHaveBeenCalledWith(video);
    expect(startTargetedWarmup).toHaveBeenCalledWith('clip-warm', video, 2.25, {
      proactive: false,
      requestRender: true,
      resumeAfterWarmup: false,
    });
  });

  it('does not reuse the previous HTML video element across same-source reordered cuts when preview WebCodecs is disabled', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const previousVideo = {
      currentTime: 6.35,
    } as HTMLVideoElement;
    const nextVideo = {
      currentTime: 0,
    } as HTMLVideoElement;
    const file = new File(['video'], 'reordered.mp4', { type: 'video/mp4' });

    manager.lastTrackState.set('track-v1', {
      clipId: 'clip-prev',
      fileId: 'media-1',
      file,
      videoElement: previousVideo,
      outPoint: 1.4,
    });

    manager.computeHandoffs({
      isPlaying: true,
      isDraggingPlayhead: false,
      clipsAtTime: [{
        id: 'clip-next',
        trackId: 'track-v1',
        file,
        inPoint: 6.8,
        outPoint: 8.4,
        source: {
          mediaFileId: 'media-1',
          videoElement: nextVideo,
        },
      }],
    });

    expect(manager.getHandoffVideoElement('clip-next')).toBeNull();
  });

  it('does not reuse the previous HTML video element across same-source reordered cuts when the source-time jump is too large', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const previousVideo = {
      currentTime: 4.2,
    } as HTMLVideoElement;
    const nextVideo = {
      currentTime: 0,
    } as HTMLVideoElement;
    const file = new File(['video'], 'reordered-large-jump.mp4', { type: 'video/mp4' });

    manager.lastTrackState.set('track-v1', {
      clipId: 'clip-prev',
      fileId: 'media-1',
      file,
      videoElement: previousVideo,
      outPoint: 1.4,
    });

    manager.computeHandoffs({
      isPlaying: true,
      isDraggingPlayhead: false,
      clipsAtTime: [{
        id: 'clip-next',
        trackId: 'track-v1',
        file,
        inPoint: 6.8,
        outPoint: 8.4,
        source: {
          mediaFileId: 'media-1',
          videoElement: nextVideo,
        },
      }],
    });

    expect(manager.getHandoffVideoElement('clip-next')).toBeNull();
  });

  it('keeps the outgoing HTML video element across a real same-source cut even when playback drift is larger than 0.5s', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const previousVideo = {
      currentTime: 5.2,
    } as HTMLVideoElement;
    const nextVideo = {
      currentTime: 0,
    } as HTMLVideoElement;
    const file = new File(['video'], 'continuous-cut.mp4', { type: 'video/mp4' });

    manager.lastTrackState.set('track-v1', {
      clipId: 'clip-prev',
      fileId: 'media-1',
      file,
      videoElement: previousVideo,
      outPoint: 6.04,
    });

    manager.computeHandoffs({
      isPlaying: true,
      isDraggingPlayhead: false,
      clipsAtTime: [{
        id: 'clip-next',
        trackId: 'track-v1',
        file,
        inPoint: 6.04,
        outPoint: 9.26,
        source: {
          mediaFileId: 'media-1',
          videoElement: nextVideo,
        },
      }],
    });

    expect(manager.getHandoffVideoElement('clip-next')).toBe(previousVideo);
    expect(engine.markVideoFramePresented).toHaveBeenCalledWith(previousVideo, 5.2, 'clip-next');
    expect(engine.captureVideoFrameAtTime).toHaveBeenCalledWith(previousVideo, 5.2, 'clip-next');
  });

  it('reuses the previous same-source video element briefly while the next split clip is still cold', () => {
    vi.useFakeTimers();
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const previousVideo = {
      currentTime: 6.08,
      readyState: 4,
      seeking: false,
      played: { length: 1 },
    } as HTMLVideoElement;
    const nextVideo = {
      currentTime: 6.04,
      readyState: 1,
      seeking: true,
      played: { length: 0 },
    } as HTMLVideoElement;
    const file = new File(['video'], 'split-cut.mp4', { type: 'video/mp4' });

    manager.lastTrackState.set('track-v1', {
      clipId: 'clip-prev',
      fileId: 'media-1',
      file,
      videoElement: previousVideo,
      outPoint: 6.04,
    });

    const clip = {
      id: 'clip-next',
      trackId: 'track-v1',
      file,
      inPoint: 6.04,
      outPoint: 9.26,
      source: {
        mediaFileId: 'media-1',
        videoElement: nextVideo,
      },
    };

    expect(manager.getPreviewContinuationVideoElement(clip, 6.08)).toBe(previousVideo);

    nextVideo.readyState = 4;
    nextVideo.seeking = false;
    nextVideo.played = { length: 1 };
    nextVideo.currentTime = 6.08;

    expect(manager.getPreviewContinuationVideoElement(clip, 6.08)).toBeNull();
    vi.useRealTimers();
  });

  it('does not reuse the previous element as a paused preview continuation when it is too far from the cut target', () => {
    flags.useFullWebCodecsPlayback = false;

    const manager = createManager();
    const previousVideo = {
      currentTime: 5.1,
      readyState: 4,
      seeking: false,
      played: { length: 1 },
    } as HTMLVideoElement;
    const nextVideo = {
      currentTime: 6.04,
      readyState: 1,
      seeking: true,
      played: { length: 0 },
    } as HTMLVideoElement;
    const file = new File(['video'], 'split-cut-far.mp4', { type: 'video/mp4' });

    manager.lastTrackState.set('track-v1', {
      clipId: 'clip-prev',
      fileId: 'media-1',
      file,
      videoElement: previousVideo,
      outPoint: 6.04,
    });

    const clip = {
      id: 'clip-next',
      trackId: 'track-v1',
      file,
      inPoint: 6.04,
      outPoint: 9.26,
      source: {
        mediaFileId: 'media-1',
        videoElement: nextVideo,
      },
    };

    expect(manager.getPreviewContinuationVideoElement(clip, 6.08)).toBeNull();
  });
});
