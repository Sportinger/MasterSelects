import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { LayerPlaybackInfo } from '../../src/services/layerPlayback/layerPlaybackState';
import { createClipSpeedSource, isUnitRateSourceWindow, resolveClipSourceTime, videoFrameSourceTime } from '../../src/services/timeline/retime/clipRetime';
import { getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import { isReverseWorkerWebCodecsCandidate, primeReverseWorkerRuntimeSourcesForPlayback } from '../../src/services/layerBuilder/reverseWorkerWebCodecsRuntime';
import { syncVideoClipToPlayback } from '../../src/services/layerPlayback/mediaSync';
import { VideoSyncHtmlClipCoordinator, type VideoSyncHtmlClipCoordinatorDeps } from '../../src/services/layerBuilder/videoSyncHtmlClipCoordinator';
import { VideoSyncHtmlSeekCoordinator } from '../../src/services/layerBuilder/videoSyncHtmlSeekCoordinator';
import { VideoSyncHtmlSeekState } from '../../src/services/layerBuilder/videoSyncHtmlSeekState';
import { providerHasTargetFrame, rememberPresentedSourceFrame, rememberSourceFrameRate, sameSourceFrame, videoHasTargetFrame, videoPausedOnTargetFrame } from '../../src/services/layerBuilder/videoSyncFrameSelection';
import { shouldSeekPausedWebCodecsProviderPolicy } from '../../src/services/layerBuilder/videoSyncWebCodecsPolicy';
import { ensureRuntimeFrameProvider } from '../../src/services/mediaRuntime/runtimePlayback';

vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: [], clipKeyframes: new Map() }) } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({ files: [] }) } }));
vi.mock('../../src/engine/featureFlags', () => ({ flags: { useFullWebCodecsPlayback: true } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: {
  getTelemetry: () => ({ mode: 'worker-presenting' }), requestNewFrameRender: vi.fn(),
  ensureVideoFrameCached: vi.fn(), getLastPresentedVideoTime: vi.fn(),
  markVideoFramePresented: vi.fn(), captureVideoFrameAtTime: vi.fn(), cacheFrameAtTime: vi.fn(),
} }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({ bindSourceRuntimeToClip: vi.fn(), releaseClipSourceRuntime: vi.fn() }));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  ensureRuntimeFrameProvider: vi.fn(), peekRuntimeFrameProvider: vi.fn(),
  releaseRuntimePlaybackSession: vi.fn(), updateRuntimePlaybackTime: vi.fn(),
}));
vi.mock('../../src/services/audio/preview/processedAudioPreviewOwnership', () => ({ ownsProcessedAudioPreview: vi.fn() }));

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return { id: 'B', trackId: 'video', startTime: 10, duration: 6 - 61 / 60,
    inPoint: 61 / 60, outPoint: 6, reversed: true, speed: 1, effects: [],
    source: { type: 'video', mediaFileId: 'media', naturalDuration: 30.037, runtimeSourceId: 'media', runtimeSessionKey: 'B' },
    ...overrides } as TimelineClip;
}
function warp(c = clip()): TimelineClip {
  return { ...c, timeRemap: { kind: 'warp', points: [
    { time: 0, source: resolveClipSourceTime(c, 0).sourceTime },
    { time: c.duration, source: resolveClipSourceTime(c, c.duration).sourceTime },
  ] } };
}
function context(c: TimelineClip, local = 4.95, playbackSpeed = 1, isPlaying = false): FrameContext {
  const speed = createClipSpeedSource(c);
  return { playheadPosition: c.startTime + local, visualPlayheadPosition: c.startTime + local,
    playbackSpeed, isPlaying, now: 1000, hasKeyframes: () => false,
    mediaFileById: new Map([['media', { id: 'media', fps: 60 }]]), mediaFileByName: new Map(),
    getSourceTimeForClip: (_id: string, t: number) => speed.integrate(t),
    getInterpolatedSpeed: (_id: string, t: number) => speed.speedAt(t),
  } as FrameContext;
}

describe('contract-based video consumer direction', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, true])('selects the same decoder and 60 fps boundary frame before/after Warp (playing=%s)', playing => {
    const plain = clip();
    const warped = warp(plain);
    for (const local of [0, 1 / 60, 1, 2.5, 4, 4.95]) {
      const before = getClipTimeInfo(context(plain, local, 1, playing), plain);
      const after = getClipTimeInfo(context(warped, local, 1, playing), warped);
      expect(after.sourceRate).toBeCloseTo(before.sourceRate, 12);
      expect(after.clipTime).toBeCloseTo(before.clipTime, 12);
      expect(Math.floor(after.clipTime * 60)).toBe(Math.floor(before.clipTime * 60));
      expect(isReverseWorkerWebCodecsCandidate(plain, context(plain, local, 1, playing))).toBe(true);
      expect(isReverseWorkerWebCodecsCandidate(warped, context(warped, local, 1, playing))).toBe(true);
    }
    expect(Math.floor(getClipTimeInfo(context(warped), warped).clipTime * 60)).toBe(62);
  });

  it('routes a forward Warp as forward despite retained reverse and negative speed', () => {
    const c = clip({ speed: -3, timeRemap: { kind: 'warp', points: [
      { time: 0, source: 1 }, { time: 5, source: 6 },
    ] } });
    expect(getClipTimeInfo(context(c), c).sourceRate).toBe(1);
    expect(isReverseWorkerWebCodecsCandidate(c, context(c))).toBe(false);
    expect(isReverseWorkerWebCodecsCandidate(c, context(c, 1, 1, true))).toBe(false);
    expect(isReverseWorkerWebCodecsCandidate(c, context(c, 1, -1, true))).toBe(true);
  });

  it('composes timeline reversal with source direction, and keeps holds out of the reverse decoder', () => {
    const reverse = warp();
    expect(isReverseWorkerWebCodecsCandidate(reverse, context(reverse, 1, -1, true))).toBe(false);
    const frozen = clip({ timeRemap: { kind: 'freeze', sourceTime: 2 } });
    expect(isReverseWorkerWebCodecsCandidate(frozen, context(frozen, 1, -1, true))).toBe(false);
    const flat = clip({ timeRemap: { kind: 'warp', points: [{ time: 0, source: 2 }, { time: 1, source: 2 }] } });
    expect(isReverseWorkerWebCodecsCandidate(flat, context(flat))).toBe(false);
    const loop = clip({ timeRemap: { kind: 'loop' } });
    expect(isReverseWorkerWebCodecsCandidate(loop, context(loop))).toBe(true);
  });

  it('primes identical biased reverse targets and skips forward/held Warps regardless of retained flags', async () => {
    const advanceReverseToTime = vi.fn();
    vi.mocked(ensureRuntimeFrameProvider).mockResolvedValue({
      isFullMode: () => true, hasFrame: () => true, advanceReverseToTime, getPendingSeekTime: () => null,
    } as never);
    for (const c of [clip(), warp()]) {
      const ctx = context(c);
      expect(await primeReverseWorkerRuntimeSourcesForPlayback({ ...ctx, clips: [c] })).toBe(1);
      expect(advanceReverseToTime).toHaveBeenLastCalledWith(getClipTimeInfo(ctx, c).clipTime);
      expect(advanceReverseToTime.mock.lastCall![0]).toBeCloseTo(1.04999, 10);
    }
    const calls = vi.mocked(ensureRuntimeFrameProvider).mock.calls.length;
    const c = clip({ timeRemap: { kind: 'warp', points: [{ time: 0, source: 1 }, { time: 5, source: 6 }] } });
    expect(await primeReverseWorkerRuntimeSourcesForPlayback({ ...context(c), clips: [c] })).toBe(0);
    expect(ensureRuntimeFrameProvider).toHaveBeenCalledTimes(calls);
  });

  it('does not declare a reverse prime ready while frame 63 is shown instead of frame 62', async () => {
    vi.useFakeTimers();
    try {
      let frameTime = 63 / 60;
      vi.mocked(ensureRuntimeFrameProvider).mockResolvedValue({
        isFullMode: () => true, hasFrame: () => true, advanceReverseToTime: vi.fn(),
        getFrameRate: () => 60, getPendingSeekTime: () => null,
        getDebugInfo: () => ({ currentFrameTimestampSeconds: frameTime }),
      } as never);
      const c = warp();
      let ready = false;
      const prime = primeReverseWorkerRuntimeSourcesForPlayback({ ...context(c), clips: [c] })
        .then(result => { ready = true; return result; });
      await vi.advanceTimersByTimeAsync(24);
      expect(ready).toBe(false);
      frameTime = 62 / 60;
      await vi.advanceTimersByTimeAsync(12);
      expect(await prime).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HTML video contract frame fallback', () => {
  function sync(c: TimelineClip, playing = false, local = 4.95) {
    const video = { currentTime: 1.063, paused: true, playbackRate: 1,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
    syncVideoClipToPlayback({ ...c, source: { ...c.source!, videoElement: video as unknown as HTMLVideoElement } }, {
      currentTime: c.startTime + local, shouldRender: true, playbackState: playing ? 'playing' : 'paused',
    } as LayerPlaybackInfo);
    return video;
  }

  it('corrects the reported 1.063s stale frame to frame 62 for both clips', () => {
    for (const c of [clip(), warp()]) {
      const video = sync(c);
      expect(video.currentTime).toBeCloseTo(1.04999, 10);
      expect(Math.floor(video.currentTime * 60)).toBe(62);
      expect(video.play).not.toHaveBeenCalled();
    }
  });

  it('seeks reverse playback and holds; native forward playback uses the resolved slope', () => {
    expect(sync(warp(), true).play).not.toHaveBeenCalled();
    const frozen = clip({ timeRemap: { kind: 'freeze', sourceTime: 3 } });
    const held = sync(frozen, true);
    expect(held.currentTime).toBe(3);
    expect(held.play).not.toHaveBeenCalled();
    const forward = clip({ timeRemap: { kind: 'warp', points: [{ time: 0, source: 1 }, { time: 5, source: 11 }] } });
    const video = sync(forward, true, 1);
    expect(video.playbackRate).toBe(2);
    expect(video.currentTime).toBe(videoFrameSourceTime(resolveClipSourceTime(forward, 1)));
    expect(video.play).toHaveBeenCalledOnce();
  });
});

describe('paused frame acceptance versus active playback drift', () => {
  function videoAt(time: number, paused = true) {
    return { currentTime: time, paused, seeking: false, readyState: 4, src: 'video.mp4',
      currentSrc: 'video.mp4', played: { length: 1 }, playbackRate: 1,
      pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), addEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
  }
  function coordinator() {
    const deps = {
      warmups: { deleteUpcomingPreplay: vi.fn(), isWarming: () => false, getRetryCooldown: () => 0 },
      htmlSeeks: { clearPreciseSeekTimer: vi.fn(), setLastSeekAt: vi.fn() },
      clipWasPlaying: new Set<string>(), clipWasDragging: new Set<string>(),
      getHandoffVideoElement: () => null, getHandoffTrackState: () => undefined,
      muteLinkedVideoSourceAudio: vi.fn(), isVideoGpuReady: () => true,
      isForceDecodeInProgress: () => false, throttledSeek: vi.fn(), beginOrQueueSettleSeek: vi.fn(),
      maybeRecoverScrubSettle: vi.fn(), maybeRecoverDraggingPendingSeek: vi.fn(),
      maybeRecoverDraggingDisplayedDrift: vi.fn(), safeSeekTime: (_video: unknown, time: number) => time,
    };
    return { deps, sync: new VideoSyncHtmlClipCoordinator(deps as unknown as VideoSyncHtmlClipCoordinatorDeps) };
  }

  it.each([false, true])('rejects frame 63 for plain/identity Warp, afterScrub=%s', afterScrub => {
    for (const c of [clip(), warp()]) {
      const { deps, sync } = coordinator();
      const video = videoAt(1.063);
      if (afterScrub) deps.clipWasDragging.add(c.id);
      sync.syncHtmlClipVideo(c, context(c), video);
      const seek = afterScrub ? deps.beginOrQueueSettleSeek : deps.throttledSeek;
      expect(seek).toHaveBeenCalledOnce();
      expect(seek.mock.calls[0][2]).toBeCloseTo(1.04999, 10);
      expect(Math.floor(seek.mock.calls[0][2] * 60)).toBe(62);
    }
  });

  it('accepts another position within frame 62 without seeking', () => {
    for (const c of [clip(), warp()]) {
      const { deps, sync } = coordinator();
      sync.syncHtmlClipVideo(c, context(c), videoAt(1.04));
      expect(deps.throttledSeek).not.toHaveBeenCalled();
      expect(deps.beginOrQueueSettleSeek).not.toHaveBeenCalled();
    }
  });

  it('rejects the previous forward frame even only 10 microseconds across a boundary', () => {
    const plain = clip({ reversed: false, inPoint: 1, duration: 5 });
    const forwardWarp = { ...warp(plain), reversed: true, speed: -3 };
    for (const c of [plain, forwardWarp]) {
      const { deps, sync } = coordinator();
      sync.syncHtmlClipVideo(c, context(c), videoAt(5.94999));
      expect(deps.throttledSeek).toHaveBeenCalledOnce();
      expect(deps.throttledSeek.mock.calls[0][2]).toBeCloseTo(5.95, 10);
      const accepted = coordinator();
      accepted.sync.syncHtmlClipVideo(c, context(c), videoAt(5.96));
      expect(accepted.deps.throttledSeek).not.toHaveBeenCalled();
    }
  });

  it('retains the 20 ms reverse and 300 ms forward playback drift thresholds', () => {
    for (const c of [clip(), warp()]) {
      const { deps, sync } = coordinator();
      sync.syncHtmlClipVideo(c, context(c, 4.95, 1, true), videoAt(1.063, false));
      expect(deps.throttledSeek).not.toHaveBeenCalled();
      sync.syncHtmlClipVideo(c, context(c, 4.95, 1, true), videoAt(1.08, false));
      expect(deps.throttledSeek).toHaveBeenCalledOnce();
    }
    const c = clip({ reversed: false, inPoint: 1, duration: 5 });
    for (const delta of [0.02, 0.29, 0.31]) {
      const { sync } = coordinator();
      const video = videoAt(5.95 + delta, false);
      sync.syncHtmlClipVideo(c, context(c, 4.95, 1, true), video);
      expect(video.currentTime).toBeCloseTo(delta > 0.3 ? 5.95 : 5.95 + delta, 10);
    }
  });

  it('does not lose a sub-frame correction inside the paused HTML seek queue', () => {
    const c = clip();
    const video = videoAt(1.05);
    rememberSourceFrameRate(video, c, context(c));
    const htmlSeeks = new VideoSyncHtmlSeekState();
    const seeks = new VideoSyncHtmlSeekCoordinator({ htmlSeeks,
      safeSeekTime: (_video, time) => time, maybeRecoverDraggingPendingSeek: () => false });
    seeks.throttledSeek(c.id, video, 1.04999, context(c));
    expect(video.currentTime).toBe(1.04999);
  });

  it('checks provider frame identity and waits for an in-flight decode without restarting it', () => {
    const provider = { currentTime: 1.063, getFrameRate: () => 60, hasFrame: () => true,
      getPendingSeekTime: () => null as number | null, isDecodePending: () => false };
    expect(shouldSeekPausedWebCodecsProviderPolicy(provider, 1.04999)).toBe(true);
    provider.currentTime = 1.04;
    expect(shouldSeekPausedWebCodecsProviderPolicy(provider, 1.04999)).toBe(false);
    provider.currentTime = 1.063;
    provider.getPendingSeekTime = () => 1.04999;
    provider.isDecodePending = () => true;
    expect(shouldSeekPausedWebCodecsProviderPolicy(provider, 1.04999)).toBe(false);
    expect(providerHasTargetFrame({ ...provider,
      getCurrentFrame: () => ({ timestamp: 1_033_333, duration: 16_667 }),
    }, 1.04999)).toBe(true);
    expect(providerHasTargetFrame({ ...provider,
      getCurrentFrame: () => ({ timestamp: 1_050_000, duration: 16_667 }),
    }, 1.04999)).toBe(false);
  });

  it('uses decoded HTML frame metadata even when currentTime already equals the requested time', () => {
    const c = clip();
    const video = videoAt(1.04999);
    rememberSourceFrameRate(video, c, context(c));
    rememberPresentedSourceFrame(video, 1.05);
    expect(videoHasTargetFrame(video, 1.04999)).toBe(false);
    rememberPresentedSourceFrame(video, 1.033333);
    expect(videoHasTargetFrame(video, 1.04999)).toBe(true);
    expect(sameSourceFrame(1.05, 1.04999, 120)).toBe(false);
    expect(sameSourceFrame(1.05, 1.04999)).toBe(false);
  });

  it('never accepts a presented frame that starts after the target, even with an averaged VFR fps', () => {
    const c = clip();
    // 70 frames in 3 s report 23.33 fps although parts run at 30 fps: 0.8 and 0.7833 share a bin.
    const vfr = { ...context(c), mediaFileById: new Map([['media', { id: 'media', fps: 23.33 }]]) } as FrameContext;
    const video = videoAt(0.78333);
    rememberSourceFrameRate(video, c, vfr);
    rememberPresentedSourceFrame(video, 0.8);
    expect(videoHasTargetFrame(video, 0.78333)).toBe(false);
    rememberPresentedSourceFrame(video, 0.766667);
    expect(videoHasTargetFrame(video, 0.78333)).toBe(true);
    // Paused after playback at 0.80 s: the element is behind no seek, yet shows F24, not F23.
    expect(sameSourceFrame(0.8, 0.78333, 23.33)).toBe(false);
    expect(sameSourceFrame(0.78, 0.7833, 30)).toBe(true);
  });

  it('does not queue a paused settle seek behind a stale frame callback', () => {
    const video = Object.assign(videoAt(1.2833), { cancelVideoFrameCallback: vi.fn(), requestVideoFrameCallback: vi.fn(() => 7) });
    const htmlSeeks = new VideoSyncHtmlSeekState();
    // A seek that stayed in the shown frame presented nothing: its callback handle never fired.
    htmlSeeks.setRvfcHandle('c', 3);
    htmlSeeks.setPendingTarget('c', 1.2833, performance.now() - 1000);
    const seeks = new VideoSyncHtmlSeekCoordinator({ htmlSeeks, safeSeekTime: (_video, time) => time, maybeRecoverDraggingPendingSeek: () => false });
    seeks.beginOrQueueSettleSeek('c', video, 1.1833);
    expect(video.currentTime).toBe(1.1833);
  });

  it('seeks a paused element that ran past the target unless its presented frame is known to fit', () => {
    const c = clip();
    const vfr = { ...context(c), mediaFileById: new Map([['media', { id: 'media', fps: 23.33 }]]) } as FrameContext;
    // Warmup playback left the element 8 ms past the target, showing the next source frame.
    const ahead = videoAt(1.2917);
    rememberSourceFrameRate(ahead, c, vfr);
    expect(videoPausedOnTargetFrame(ahead, 1.2833)).toBe(false);
    // Seeked onto the target, the presented 10 fps frame (pts 1.2) counts even though an averaged
    // 23.33 fps bin would separate it; a later presented frame never does.
    const onTarget = videoAt(1.2833);
    rememberSourceFrameRate(onTarget, c, vfr);
    expect(videoPausedOnTargetFrame(onTarget, 1.2833)).toBe(true);
    rememberPresentedSourceFrame(onTarget, 1.2);
    expect(videoPausedOnTargetFrame(onTarget, 1.2833)).toBe(true);
    rememberPresentedSourceFrame(onTarget, 1.3);
    expect(videoPausedOnTargetFrame(onTarget, 1.2833)).toBe(false);
  });

  it('allows unit-rate forward Warp preplay despite retained flags and rejects a loop wrap', () => {
    const forward = { ...warp(clip({ reversed: false })), reversed: true, speed: -3 };
    expect(isUnitRateSourceWindow(forward, 0, 0.25)).toBe(true);
    expect(isUnitRateSourceWindow(warp(), 0, 0.25)).toBe(false);
    const loop = clip({ reversed: false, inPoint: 0, outPoint: 1, duration: 5, timeRemap: { kind: 'loop' } });
    expect(isUnitRateSourceWindow(loop, 0.9, 1.1)).toBe(false);
    expect(isUnitRateSourceWindow(loop, 0.1, 0.3)).toBe(true);
  });
});
