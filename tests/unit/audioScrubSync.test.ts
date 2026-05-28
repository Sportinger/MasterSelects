import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSyncHandler } from '../../src/services/layerBuilder/AudioSyncHandler';
import { AudioTrackSyncManager } from '../../src/services/layerBuilder/AudioTrackSyncManager';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import { useTimelineStore } from '../../src/stores/timeline';
import type { FrameContext, AudioSyncState } from '../../src/services/layerBuilder/types';
import type { AudioMeterSnapshot, TimelineClip } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

type ProxyFrameCacheTestAccess = typeof proxyFrameCache & {
  playScrubAudio: typeof proxyFrameCache.playScrubAudio;
  hasAudioBuffer: typeof proxyFrameCache.hasAudioBuffer;
  getCachedAudioProxy: typeof proxyFrameCache.getCachedAudioProxy;
  preloadAudioProxy: typeof proxyFrameCache.preloadAudioProxy;
  getAudioBuffer: typeof proxyFrameCache.getAudioBuffer;
  stopScrubAudio: typeof proxyFrameCache.stopScrubAudio;
  getScrubMeterSnapshot: typeof proxyFrameCache.getScrubMeterSnapshot;
};
type AudioTrackSyncManagerTestAccess = {
  audioSyncHandler: Pick<AudioSyncHandler, 'syncAudioElement' | 'stopScrubAudio'>;
  syncAudioTrackClips: (ctx: FrameContext, state: AudioSyncState) => void;
  syncVideoClipAudio: (ctx: FrameContext, state: AudioSyncState) => void;
};

const testProxyFrameCache = proxyFrameCache as ProxyFrameCacheTestAccess;

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'clip-1',
    trackId: 'track-1',
    name: 'clip',
    duration: 10,
    outPoint: 10,
    preservesPitch: true,
    ...overrides,
  });
}

function makeFrameContext(overrides: Record<string, unknown> = {}) {
  const clips = (overrides.clips as TimelineClip[] | undefined) ?? [];
  const clipsAtTime = (overrides.clipsAtTime as TimelineClip[] | undefined) ?? clips;
  const mediaFiles = (overrides.mediaFiles as Array<{ id: string; name?: string }> | undefined) ?? [];

  return {
    clips,
    clipsAtTime,
    tracks: [],
    videoTracks: (overrides.videoTracks as unknown[]) ?? [],
    audioTracks: (overrides.audioTracks as unknown[]) ?? [],
    visibleVideoTrackIds: (overrides.visibleVideoTrackIds as Set<string>) ?? new Set(),
    unmutedAudioTrackIds: (overrides.unmutedAudioTrackIds as Set<string>) ?? new Set(),
    clipsByTrackId: new Map(clipsAtTime.map((clip) => [clip.trackId, clip])),
    mediaFiles,
    mediaFileById: new Map(mediaFiles.map((file) => [file.id, file])),
    mediaFileByName: new Map(),
    compositionById: new Map(),
    isPlaying: false,
    isDraggingPlayhead: true,
    playheadPosition: 1,
    playbackSpeed: 1,
    proxyEnabled: false,
    activeCompId: 'default',
    frameNumber: 30,
    now: 100,
    getInterpolatedTransform: () => ({}),
    getInterpolatedEffects: () => [],
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: (_clipId: string, clipLocalTime: number) => clipLocalTime,
    hasKeyframes: () => false,
    ...overrides,
  } as unknown as FrameContext;
}

function makeMeterSnapshot(peakLinear: number, updatedAt: number): AudioMeterSnapshot {
  return {
    peakLinear,
    rmsLinear: peakLinear * 0.5,
    peakDb: peakLinear > 0 ? 20 * Math.log10(peakLinear) : -120,
    rmsDb: peakLinear > 0 ? 20 * Math.log10(peakLinear * 0.5) : -120,
    clipping: false,
    updatedAt,
  };
}

function stubProxyFrameCache(overrides: { hasAudioBuffer?: boolean } = {}) {
  const originalPlayScrubAudio = testProxyFrameCache.playScrubAudio;
  const originalHasAudioBuffer = testProxyFrameCache.hasAudioBuffer;
  const originalGetCachedAudioProxy = testProxyFrameCache.getCachedAudioProxy;
  const originalPreloadAudioProxy = testProxyFrameCache.preloadAudioProxy;
  const originalGetAudioBuffer = testProxyFrameCache.getAudioBuffer;
  const originalStopScrubAudio = testProxyFrameCache.stopScrubAudio;
  const originalGetScrubMeterSnapshot = testProxyFrameCache.getScrubMeterSnapshot;
  const playScrubAudio = vi.fn();
  const hasAudioBuffer = vi.fn(() => overrides.hasAudioBuffer ?? true);
  const getCachedAudioProxy = vi.fn(() => null);
  const preloadAudioProxy = vi.fn();
  const getAudioBuffer = vi.fn();
  const stopScrubAudio = vi.fn();
  const getScrubMeterSnapshot = vi.fn(() => null);

  testProxyFrameCache.playScrubAudio = playScrubAudio;
  testProxyFrameCache.hasAudioBuffer = hasAudioBuffer;
  testProxyFrameCache.getCachedAudioProxy = getCachedAudioProxy;
  testProxyFrameCache.preloadAudioProxy = preloadAudioProxy;
  testProxyFrameCache.getAudioBuffer = getAudioBuffer;
  testProxyFrameCache.stopScrubAudio = stopScrubAudio;
  testProxyFrameCache.getScrubMeterSnapshot = getScrubMeterSnapshot;

  return {
    playScrubAudio,
    hasAudioBuffer,
    getCachedAudioProxy,
    preloadAudioProxy,
    getAudioBuffer,
    stopScrubAudio,
    getScrubMeterSnapshot,
    restore: () => {
      testProxyFrameCache.playScrubAudio = originalPlayScrubAudio;
      testProxyFrameCache.hasAudioBuffer = originalHasAudioBuffer;
      testProxyFrameCache.getCachedAudioProxy = originalGetCachedAudioProxy;
      testProxyFrameCache.preloadAudioProxy = originalPreloadAudioProxy;
      testProxyFrameCache.getAudioBuffer = originalGetAudioBuffer;
      testProxyFrameCache.stopScrubAudio = originalStopScrubAudio;
      testProxyFrameCache.getScrubMeterSnapshot = originalGetScrubMeterSnapshot;
    },
  };
}

describe('scrub audio sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useTimelineStore.setState({ audioRegionGainPreview: null });
  });

  it('applies clip volume during fallback scrub playback instead of a fixed default', () => {
    const handler = new AudioSyncHandler();
    const play = vi.fn().mockResolvedValue(undefined);
    const element = {
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play,
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;

    handler.syncAudioElement(
      {
        element,
        clip: makeClip(),
        clipTime: 1.2,
        absSpeed: 1,
        isMuted: false,
        canBeMaster: false,
        type: 'audioTrack',
        volume: 0.2,
      },
      makeFrameContext(),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(element.volume).toBe(0.2);
    expect(element.currentTime).toBe(1.2);
    expect(play).toHaveBeenCalledOnce();
  });

  it('routes scrub fallback through Web Audio when EQ is present', () => {
    const handler = new AudioSyncHandler();
    const applyEffects = vi.spyOn(audioRoutingManager, 'applyEffects').mockResolvedValue(true);
    const element = {
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;

    handler.syncAudioElement(
      {
        element,
        clip: makeClip(),
        clipTime: 0.5,
        absSpeed: 1,
        isMuted: false,
        canBeMaster: false,
        type: 'audioTrack',
        volume: 0.75,
        eqGains: [0, 0, 0, 0, 0, 6, 0, 0, 0, 0],
      },
      makeFrameContext(),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(applyEffects).toHaveBeenCalledWith(element, 0.75, [0, 0, 0, 0, 0, 6, 0, 0, 0, 0], 0, [], undefined);
  });

  it('routes playback through Web Audio when live processors are present', () => {
    const handler = new AudioSyncHandler();
    const applyEffects = vi.spyOn(audioRoutingManager, 'applyEffects').mockResolvedValue(true);
    const element = {
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;
    const processors = [{ id: 'hp', type: 'high-pass' as const, frequencyHz: 100, q: 0.707 }];

    handler.syncAudioElement(
      {
        element,
        clip: makeClip(),
        clipTime: 0.5,
        absSpeed: 1,
        isMuted: false,
        canBeMaster: false,
        type: 'audioTrack',
        volume: 1,
        processors,
      },
      makeFrameContext({ isDraggingPlayhead: false, isPlaying: true }),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(applyEffects).toHaveBeenCalledWith(element, 1, new Array(10).fill(0), 0, processors, undefined);
  });

  it('routes playback through Web Audio when a runtime meter target exists', () => {
    const handler = new AudioSyncHandler();
    const applyEffects = vi.spyOn(audioRoutingManager, 'applyEffects').mockResolvedValue(true);
    const element = {
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0,
      paused: true,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;

    handler.syncAudioElement(
      {
        element,
        clip: makeClip(),
        clipTime: 0.5,
        absSpeed: 1,
        isMuted: false,
        canBeMaster: false,
        type: 'audioTrack',
        volume: 0.75,
        meterTrackId: 'audio-track',
      },
      makeFrameContext({ isDraggingPlayhead: false, isPlaying: true }),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(applyEffects).toHaveBeenCalledWith(element, 0.75, new Array(10).fill(0), 0, [], undefined);
  });

  it('keeps routed meters alive after playback stops while an effect tail is audible', () => {
    const handler = new AudioSyncHandler();
    const element = {
      muted: false,
      volume: 1,
      playbackRate: 1,
      currentTime: 0.5,
      paused: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;
    let peakLinear = 0.25;

    vi.spyOn(audioRoutingManager, 'hasRoute').mockReturnValue(true);
    vi.spyOn(audioRoutingManager, 'getMeterSnapshot')
      .mockImplementation((_element, updatedAt = performance.now()) => makeMeterSnapshot(peakLinear, updatedAt));
    vi.spyOn(audioRoutingManager, 'getMasterMeterSnapshot')
      .mockImplementation((updatedAt = performance.now()) => makeMeterSnapshot(peakLinear, updatedAt));
    const updateRuntimeAudioMeter = vi.spyOn(useTimelineStore.getState(), 'updateRuntimeAudioMeter');

    handler.syncAudioElement(
      {
        element,
        clip: makeClip(),
        clipTime: 0.5,
        absSpeed: 1,
        isMuted: false,
        canBeMaster: false,
        type: 'audioTrack',
        volume: 1,
        meterTrackId: 'audio-track',
      },
      makeFrameContext({ isDraggingPlayhead: false, isPlaying: false, now: 100 }),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(element.pause).toHaveBeenCalledOnce();
    expect(updateRuntimeAudioMeter).toHaveBeenCalledWith(
      'audio-track',
      expect.objectContaining({ peakLinear: 0.25 }),
      expect.objectContaining({ peakLinear: 0.25 })
    );

    updateRuntimeAudioMeter.mockClear();
    peakLinear = 0.1;
    vi.advanceTimersByTime(50);
    expect(updateRuntimeAudioMeter).toHaveBeenCalledWith(
      'audio-track',
      expect.objectContaining({ peakLinear: 0.1 }),
      expect.objectContaining({ peakLinear: 0.1 })
    );

    updateRuntimeAudioMeter.mockClear();
    peakLinear = 0;
    vi.advanceTimersByTime(800);
    expect(updateRuntimeAudioMeter).toHaveBeenLastCalledWith(
      'audio-track',
      expect.objectContaining({ peakLinear: 0 }),
      expect.objectContaining({ peakLinear: 0 })
    );
  });

  it('uses linked audio clip settings for varispeed scrub audio and skips proxy fallback duplication', () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerTestAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };

    const cacheStub = stubProxyFrameCache();

    const videoElement = {
      muted: false,
      currentSrc: 'blob:video-src',
      src: 'blob:video-src',
    } as unknown as HTMLAudioElement;

    const videoClip = makeClip({
      id: 'video-1',
      trackId: 'video-track',
      linkedClipId: 'audio-1',
      mediaFileId: 'media-1',
      source: { type: 'video', videoElement: videoElement as unknown as HTMLVideoElement },
    });

    const linkedAudioClip = makeClip({
      id: 'audio-1',
      trackId: 'audio-track',
      linkedClipId: 'video-1',
      source: { type: 'audio', audioElement: { paused: true, src: 'blob:audio-src', readyState: 4 } as unknown as HTMLAudioElement },
    });

    const ctx = makeFrameContext({
      clips: [videoClip, linkedAudioClip],
      clipsAtTime: [videoClip, linkedAudioClip],
      videoTracks: [{ id: 'video-track', type: 'video', visible: true }],
      audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
      visibleVideoTrackIds: new Set(['video-track']),
      unmutedAudioTrackIds: new Set(['audio-track']),
      proxyEnabled: true,
      mediaFiles: [{ id: 'media-1', name: 'clip.mp4', hasProxyAudio: true, proxyStatus: 'ready' }],
      getInterpolatedEffects: (clipId: string) => clipId === 'audio-1'
        ? [
            { id: 'vol-1', type: 'audio-volume', params: { volume: 0.25 } },
            { id: 'eq-1', type: 'audio-eq', params: { band1k: 6 } },
          ]
        : [],
    });

    manager.syncVideoClipAudio(
      ctx,
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(cacheStub.playScrubAudio).toHaveBeenCalledWith(
      'media-1',
      1,
      undefined,
      'blob:video-src',
      expect.objectContaining({
        volume: 0.25,
        eqGains: expect.arrayContaining([6]),
      })
    );
    expect(syncAudioElement).not.toHaveBeenCalled();
    expect(videoElement.muted).toBe(true);

    cacheStub.restore();
  });

  it('suppresses linked audio clip scrub fallback once varispeed scrub audio is ready', () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerTestAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };

    const cacheStub = stubProxyFrameCache();

    const videoClip = makeClip({
      id: 'video-1',
      trackId: 'video-track',
      linkedClipId: 'audio-1',
      mediaFileId: 'media-1',
      source: { type: 'video', videoElement: { muted: false } as unknown as HTMLVideoElement },
    });

    const audioElement = {
      paused: true,
      pause: vi.fn(),
      src: 'blob:audio-src',
      readyState: 4,
    } as unknown as HTMLAudioElement;

    const linkedAudioClip = makeClip({
      id: 'audio-1',
      trackId: 'audio-track',
      linkedClipId: 'video-1',
      source: { type: 'audio', audioElement: audioElement as unknown as HTMLAudioElement },
    });

    const ctx = makeFrameContext({
      clips: [videoClip, linkedAudioClip],
      clipsAtTime: [videoClip, linkedAudioClip],
      audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
      videoTracks: [{ id: 'video-track', type: 'video', visible: true }],
      unmutedAudioTrackIds: new Set(['audio-track']),
      visibleVideoTrackIds: new Set(['video-track']),
      mediaFiles: [{ id: 'media-1', name: 'clip.mp4' }],
    });

    manager.syncAudioTrackClips(
      ctx,
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(syncAudioElement).not.toHaveBeenCalled();
    cacheStub.restore();
  });

  it('applies live region gain preview to normal audio-track playback', () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerTestAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };

    const audioElement = {
      paused: true,
      src: 'blob:audio-src',
      readyState: 4,
    } as unknown as HTMLAudioElement;
    const audioClip = makeClip({
      id: 'audio-1',
      trackId: 'audio-track',
      source: { type: 'audio', audioElement },
      audioState: {
        editStack: [{
          id: 'old-gain',
          type: 'gain',
          enabled: true,
          params: { gainDb: -3, fadeInSeconds: 0, fadeOutSeconds: 0 },
          timeRange: { start: 0, end: 10 },
          createdAt: 1,
        }],
      },
    });

    useTimelineStore.setState({
      audioRegionGainPreview: {
        clipId: 'audio-1',
        trackId: 'audio-track',
        sourceInPoint: 0,
        sourceOutPoint: 10,
        gainDb: -12,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
      },
    });

    const ctx = makeFrameContext({
      clips: [audioClip],
      clipsAtTime: [audioClip],
      audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
      unmutedAudioTrackIds: new Set(['audio-track']),
      isDraggingPlayhead: false,
      isPlaying: true,
      playheadPosition: 5,
      frameNumber: 150,
    });

    manager.syncAudioTrackClips(
      ctx,
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(syncAudioElement).toHaveBeenCalledOnce();
    const [target, passedCtx] = syncAudioElement.mock.calls[0];
    expect(target).toEqual(expect.objectContaining({
      element: audioElement,
      clip: audioClip,
    }));
    expect(target.volume).toBeCloseTo(10 ** (-12 / 20), 4);
    expect(passedCtx).toBe(ctx);
  });
});
