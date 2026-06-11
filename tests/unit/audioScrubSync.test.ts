import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSyncHandler } from '../../src/services/layerBuilder/AudioSyncHandler';
import { AudioTrackSyncManager } from '../../src/services/layerBuilder/AudioTrackSyncManager';
import type { AudioTrackRuntimeElementManager } from '../../src/services/layerBuilder/audioTrackRuntimeElements';
import type { AudioTrackStemLayerBufferCache } from '../../src/services/layerBuilder/audioTrackStemLayerBuffers';
import type { AudioTrackStemPreviewElementManager } from '../../src/services/layerBuilder/audioTrackStemPreviewElements';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import { clearCompositionAudioMixdownCache } from '../../src/services/timeline/compositionAudioMixdownCache';
import {
  getLazyTimelineAudioElementForClip,
  getLazyTimelineVideoElementForClip,
  hydrateTimelineMediaWindow,
  releaseAllLazyTimelineMediaElements,
} from '../../src/services/timeline/lazyMediaElements';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { StemAudioSourceResolver } from '../../src/services/audio/stemSeparation';
import type { FrameContext, AudioSyncState } from '../../src/services/layerBuilder/types';
import type { AudioMeterSnapshot, ClipAudioStemLayer, TimelineClip } from '../../src/types';
import type { RenderResourceDescriptor } from '../../src/services/timeline/runtimeCoordinatorTypes';
import { createMockClip } from '../helpers/mockData';

const compositionAudioMixerMocks = vi.hoisted(() => ({
  mixdownComposition: vi.fn(),
  createAudioElement: vi.fn(),
}));

vi.mock('../../src/services/compositionAudioMixer', () => ({
  compositionAudioMixer: compositionAudioMixerMocks,
}));

type ProxyFrameCacheTestAccess = typeof proxyFrameCache & {
  playScrubAudio: typeof proxyFrameCache.playScrubAudio;
  hasAudioBuffer: typeof proxyFrameCache.hasAudioBuffer;
  getCachedAudioBuffer: typeof proxyFrameCache.getCachedAudioBuffer;
  getCachedAudioProxy: typeof proxyFrameCache.getCachedAudioProxy;
  getAudioProxy: typeof proxyFrameCache.getAudioProxy;
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
type AudioTrackSyncManagerRuntimeTestAccess = AudioTrackSyncManagerTestAccess & {
  runtimeElements: AudioTrackRuntimeElementManager;
  stemLayerBuffers: AudioTrackStemLayerBufferCache;
  stemPreviewElements: AudioTrackStemPreviewElementManager;
};

const testProxyFrameCache = proxyFrameCache as ProxyFrameCacheTestAccess;

function getInteractivePolicyBudget() {
  const budget = timelineRuntimeCoordinator.getPolicy('interactive')?.defaultBudget;
  if (!budget) throw new Error('Missing interactive runtime policy budget');
  return budget;
}

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

function makeStemLayer(overrides: Partial<ClipAudioStemLayer> = {}): ClipAudioStemLayer {
  return {
    id: 'vocals',
    label: 'Vocals',
    gainDb: 0,
    muted: false,
    mediaFileId: 'stem-media',
    sourceFingerprint: 'source-fingerprint',
    manifestArtifactId: 'stem-manifest',
    payloadRef: {
      artifactId: 'stem-artifact',
      hash: 'stem-hash',
    },
    ...overrides,
  } as ClipAudioStemLayer;
}

function makeAudioBuffer(duration = 1, sampleRate = 48_000, channelCount = 2): AudioBuffer {
  const length = Math.round(duration * sampleRate);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  return {
    duration,
    sampleRate,
    numberOfChannels: channelCount,
    length,
    getChannelData: (channel: number) => channels[channel] ?? channels[0],
  } as unknown as AudioBuffer;
}

function createRetainedInteractiveAudioResource(index: number): RenderResourceDescriptor {
  return {
    id: `retained-interactive-audio-${index}`,
    kind: 'html-media',
    policyId: 'interactive',
    owner: {
      ownerId: `retained-interactive-audio-${index}`,
      ownerType: 'timeline',
    },
    mediaElementKind: 'audio',
    elementId: `retained-interactive-audio-${index}`,
    diagnostics: {
      status: 'ok',
    },
  };
}

function mockMediaStoreFiles(files: unknown[]): void {
  (useMediaStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    files,
  });
}

function installObjectUrlMocks(url = 'blob:stem-preview-audio'): {
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const createObjectURL = vi.fn(() => url);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  return {
    createObjectURL,
    revokeObjectURL,
    restore: () => {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    },
  };
}

function stubProxyFrameCache(overrides: { hasAudioBuffer?: boolean } = {}) {
  const originalPlayScrubAudio = testProxyFrameCache.playScrubAudio;
  const originalHasAudioBuffer = testProxyFrameCache.hasAudioBuffer;
  const originalGetCachedAudioBuffer = testProxyFrameCache.getCachedAudioBuffer;
  const originalGetCachedAudioProxy = testProxyFrameCache.getCachedAudioProxy;
  const originalGetAudioProxy = testProxyFrameCache.getAudioProxy;
  const originalPreloadAudioProxy = testProxyFrameCache.preloadAudioProxy;
  const originalGetAudioBuffer = testProxyFrameCache.getAudioBuffer;
  const originalStopScrubAudio = testProxyFrameCache.stopScrubAudio;
  const originalGetScrubMeterSnapshot = testProxyFrameCache.getScrubMeterSnapshot;
  const playScrubAudio = vi.fn();
  const hasAudioBuffer = vi.fn(() => overrides.hasAudioBuffer ?? true);
  const getCachedAudioBuffer = vi.fn(() => null);
  const getCachedAudioProxy = vi.fn(() => null);
  const getAudioProxy = vi.fn(async () => null);
  const preloadAudioProxy = vi.fn();
  const getAudioBuffer = vi.fn();
  const stopScrubAudio = vi.fn();
  const getScrubMeterSnapshot = vi.fn(() => null);

  testProxyFrameCache.playScrubAudio = playScrubAudio;
  testProxyFrameCache.hasAudioBuffer = hasAudioBuffer;
  testProxyFrameCache.getCachedAudioBuffer = getCachedAudioBuffer;
  testProxyFrameCache.getCachedAudioProxy = getCachedAudioProxy;
  testProxyFrameCache.getAudioProxy = getAudioProxy;
  testProxyFrameCache.preloadAudioProxy = preloadAudioProxy;
  testProxyFrameCache.getAudioBuffer = getAudioBuffer;
  testProxyFrameCache.stopScrubAudio = stopScrubAudio;
  testProxyFrameCache.getScrubMeterSnapshot = getScrubMeterSnapshot;

  return {
    playScrubAudio,
    hasAudioBuffer,
    getCachedAudioBuffer,
    getCachedAudioProxy,
    getAudioProxy,
    preloadAudioProxy,
    getAudioBuffer,
    stopScrubAudio,
    getScrubMeterSnapshot,
    restore: () => {
      testProxyFrameCache.playScrubAudio = originalPlayScrubAudio;
      testProxyFrameCache.hasAudioBuffer = originalHasAudioBuffer;
      testProxyFrameCache.getCachedAudioBuffer = originalGetCachedAudioBuffer;
      testProxyFrameCache.getCachedAudioProxy = originalGetCachedAudioProxy;
      testProxyFrameCache.getAudioProxy = originalGetAudioProxy;
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
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    releaseAllLazyTimelineMediaElements();
    vi.restoreAllMocks();
    useTimelineStore.setState({ audioRegionGainPreview: null });
    clearCompositionAudioMixdownCache();
    compositionAudioMixerMocks.mixdownComposition.mockReset();
    compositionAudioMixerMocks.createAudioElement.mockReset();
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

    const videoClip = makeClip({
      id: 'video-1',
      trackId: 'video-track',
      linkedClipId: 'audio-1',
      mediaFileId: 'media-1',
      source: { type: 'video', mediaFileId: 'media-1' },
    });

    const linkedAudioClip = makeClip({
      id: 'audio-1',
      trackId: 'audio-track',
      linkedClipId: 'video-1',
      source: { type: 'audio', mediaFileId: 'audio-1' },
    });

    const ctx = makeFrameContext({
      clips: [videoClip, linkedAudioClip],
      clipsAtTime: [videoClip, linkedAudioClip],
      videoTracks: [{ id: 'video-track', type: 'video', visible: true }],
      audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
      visibleVideoTrackIds: new Set(['video-track']),
      unmutedAudioTrackIds: new Set(['audio-track']),
      proxyEnabled: true,
      mediaFiles: [
        { id: 'media-1', name: 'clip.mp4', url: 'blob:video-src', hasProxyAudio: true, proxyStatus: 'ready' },
        { id: 'audio-1', name: 'clip-audio.wav', url: 'blob:audio-src' },
      ],
      getInterpolatedEffects: (clipId: string) => clipId === 'audio-1'
        ? [
            { id: 'vol-1', type: 'audio-volume', params: { volume: 0.25 } },
            { id: 'eq-1', type: 'audio-eq', params: { band1k: 6 } },
          ]
        : [],
    });

    hydrateTimelineMediaWindow(ctx);
    const videoElement = getLazyTimelineVideoElementForClip(videoClip);
    expect(videoElement).toBeInstanceOf(HTMLVideoElement);

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
    expect(videoElement?.muted).toBe(true);

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
    const cacheStub = stubProxyFrameCache({ hasAudioBuffer: false });
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };

    const audioClip = makeClip({
      id: 'audio-1',
      trackId: 'audio-track',
      source: { type: 'audio', mediaFileId: 'media-audio-1' },
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
      mediaFiles: [{ id: 'media-audio-1', name: 'audio-1.wav', url: 'blob:audio-src' }],
      isDraggingPlayhead: false,
      isPlaying: true,
      playheadPosition: 5,
      frameNumber: 150,
    });

    hydrateTimelineMediaWindow(ctx);
    const audioElement = getLazyTimelineAudioElementForClip(audioClip);
    expect(audioElement).toBeInstanceOf(HTMLAudioElement);

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
    cacheStub.restore();
  });

  it('lazily hydrates data-only composition audio for audio-track playback', async () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerTestAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };
    const buffer = { duration: 10 } as AudioBuffer;
    const audioElement = {
      paused: true,
      src: 'blob:composition-mixdown',
      readyState: 4,
    } as unknown as HTMLAudioElement;
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue({
      buffer,
      waveform: [0, 0.4, 0.2],
      duration: 10,
      hasAudio: true,
    });
    compositionAudioMixerMocks.createAudioElement.mockReturnValue(audioElement);
    const audioClip = makeClip({
      id: 'comp-audio',
      trackId: 'audio-track',
      isComposition: true,
      compositionId: 'comp-1',
      nestedContentHash: 'hash-a',
      source: { type: 'audio', naturalDuration: 10 },
      hasMixdownAudio: false,
      mixdownBuffer: undefined,
    });
    useTimelineStore.setState({
      clips: [audioClip],
      audioRegionGainPreview: null,
    });

    const ctx = makeFrameContext({
      clips: [audioClip],
      clipsAtTime: [audioClip],
      audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
      unmutedAudioTrackIds: new Set(['audio-track']),
      isDraggingPlayhead: false,
      isPlaying: true,
      playheadPosition: 2,
      frameNumber: 60,
    });

    manager.syncAudioTrackClips(
      ctx,
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );
    for (let tick = 0; tick < 50; tick += 1) {
      await Promise.resolve();
      const updated = useTimelineStore.getState().clips.find(clip => clip.id === 'comp-audio');
      if (updated?.source?.audioElement === audioElement) break;
    }

    expect(syncAudioElement).not.toHaveBeenCalled();
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledOnce();
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledWith('comp-1');
    expect(compositionAudioMixerMocks.createAudioElement).toHaveBeenCalledWith(buffer, { ownerClipId: 'comp-audio' });
    const updatedClip = useTimelineStore.getState().clips.find(clip => clip.id === 'comp-audio');
    expect(updatedClip).toEqual(expect.objectContaining({
      mixdownBuffer: buffer,
      mixdownWaveform: [0, 0.4, 0.2],
      waveform: [0, 0.4, 0.2],
      hasMixdownAudio: true,
      mixdownGenerating: false,
    }));
    expect(updatedClip?.source?.audioElement).toBe(audioElement);
  });

  it('clears composition audio generating state when lazy mixdown returns no result', async () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerTestAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };
    compositionAudioMixerMocks.mixdownComposition.mockResolvedValue(null);
    const audioClip = makeClip({
      id: 'missing-comp-audio',
      trackId: 'audio-track',
      isComposition: true,
      compositionId: 'missing-comp',
      nestedContentHash: 'missing-hash',
      source: { type: 'audio', naturalDuration: 10 },
      hasMixdownAudio: false,
      mixdownBuffer: undefined,
      mixdownGenerating: false,
    });
    useTimelineStore.setState({
      clips: [audioClip],
      audioRegionGainPreview: null,
    });

    manager.syncAudioTrackClips(
      makeFrameContext({
        clips: [audioClip],
        clipsAtTime: [audioClip],
        audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
        unmutedAudioTrackIds: new Set(['audio-track']),
        isDraggingPlayhead: false,
        isPlaying: true,
        playheadPosition: 2,
        frameNumber: 60,
      }),
      { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false }
    );

    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'missing-comp-audio')?.mixdownGenerating).toBe(true);
    for (let tick = 0; tick < 50; tick += 1) {
      await Promise.resolve();
      const updated = useTimelineStore.getState().clips.find(clip => clip.id === 'missing-comp-audio');
      if (updated?.mixdownGenerating === false) break;
    }

    expect(syncAudioElement).not.toHaveBeenCalled();
    expect(compositionAudioMixerMocks.mixdownComposition).toHaveBeenCalledWith('missing-comp');
    const updatedClip = useTimelineStore.getState().clips.find(clip => clip.id === 'missing-comp-audio');
    expect(updatedClip).toEqual(expect.objectContaining({
      mixdownGenerating: false,
      mixdownBuffer: undefined,
    }));
    expect(updatedClip?.mixdownAudio).toBeUndefined();
  });
});

describe('AudioTrackSyncManager stem layer buffer runtime reporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    mockMediaStoreFiles([]);
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    mockMediaStoreFiles([]);
    vi.restoreAllMocks();
  });

  it('reports retained stem layer buffers and releases them when the cache clears', () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerRuntimeTestAccess;
    const layer = makeStemLayer();
    const buffer = makeAudioBuffer(2, 48_000, 2);

    expect(manager.stemLayerBuffers.cacheStemLayerBuffer(layer, 'stem-cache-key', buffer)).toBe(true);

    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.interactive;
    const resource = stats.resources.find((entry) =>
      entry.tags?.includes('stem-layer-buffer') &&
      entry.source?.sourceId === 'vocals'
    );

    expect(resource).toMatchObject({
      kind: 'audio-source-clock',
      policyId: 'interactive',
      owner: {
        ownerId: 'audio-track-sync:stem-layer-buffer-cache',
        ownerType: 'timeline',
        mediaFileId: 'stem-media',
      },
      source: {
        sourceId: 'vocals',
        mediaFileId: 'stem-media',
        fileHash: 'stem-hash',
      },
      dimensions: {
        durationSeconds: 2,
        sampleRate: 48_000,
        channelCount: 2,
      },
      memoryCost: {
        heapBytes: 2 * 48_000 * 2 * 4,
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'lease-visible',
      'stem-layer-buffer',
    ]));
    expect(stats.budgetReport.usage.audioSources).toBe(1);
    expect(manager.stemLayerBuffers.has('stem-cache-key')).toBe(true);

    manager.stemLayerBuffers.clear();

    expect(manager.stemLayerBuffers.has('stem-cache-key')).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resource?.id })]));
  });

  it('skips stem layer buffer cache retention when the interactive heap budget is full', () => {
    timelineRuntimeCoordinator.retainResource({
      id: 'retained-stem-budget',
      kind: 'audio-source-clock',
      policyId: 'interactive',
      owner: {
        ownerId: 'retained-stem-budget',
        ownerType: 'timeline',
      },
      audioSourceId: 'retained-stem-budget',
      memoryCost: {
        heapBytes: getInteractivePolicyBudget().maxHeapBytes ?? 0,
      },
    });
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerRuntimeTestAccess;

    expect(manager.stemLayerBuffers.cacheStemLayerBuffer(
      makeStemLayer(),
      'denied-stem-cache-key',
      makeAudioBuffer(),
    )).toBe(false);

    expect(manager.stemLayerBuffers.has('denied-stem-cache-key')).toBe(false);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          owner: expect.objectContaining({ ownerId: 'audio-track-sync:stem-layer-buffer-cache' }),
        }),
      ]));
  });

  it('reports cloned active audio proxy elements and releases them on proxy removal', () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerRuntimeTestAccess;
    const cacheStub = stubProxyFrameCache();
    const sharedProxy = document.createElement('audio');
    sharedProxy.src = 'blob:shared-audio-proxy';
    cacheStub.getCachedAudioProxy.mockReturnValue(sharedProxy);
    mockMediaStoreFiles([{
      id: 'media-audio-proxy',
      name: 'audio-proxy.wav',
      url: 'blob:shared-audio-proxy',
      hasProxyAudio: true,
      audioProxyStatus: 'ready',
    }]);

    const proxy = manager.runtimeElements.getAudioTrackProxyForClip(
      'media-audio-proxy',
      'clip-audio-proxy',
    );

    expect(proxy).not.toBeNull();
    expect(proxy).not.toBe(sharedProxy);
    const resource = timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .find((entry) => entry.tags?.includes('active-audio-proxy'));
    expect(resource).toMatchObject({
      kind: 'html-media',
      policyId: 'interactive',
      mediaElementKind: 'audio',
      srcKind: 'blob-url',
      owner: {
        ownerId: 'audio-track-sync:active-audio-proxy:clip-audio-proxy',
        ownerType: 'clip',
        clipId: 'clip-audio-proxy',
        mediaFileId: 'media-audio-proxy',
      },
      source: {
        sourceId: 'media-audio-proxy',
        mediaFileId: 'media-audio-proxy',
      },
    });
    expect(resource?.tags).toEqual(expect.arrayContaining([
      'runtime-provider-demand',
      'lease-visible',
      'active-audio-proxy',
    ]));
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.budgetReport.usage.htmlMediaElements).toBe(1);

    manager.runtimeElements.removeAudioTrackProxy('clip-audio-proxy');

    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resource?.id })]));
    cacheStub.restore();
  });

  it('reports stem preview buffer audio elements and revokes owned object URLs on disposal', async () => {
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerRuntimeTestAccess;
    const layer = makeStemLayer();
    const key = 'stem-preview-set';
    const buffer = makeAudioBuffer(1.5, 44_100, 2);
    const objectUrls = installObjectUrlMocks('blob:stem-preview-buffer');
    vi.spyOn(StemAudioSourceResolver.prototype, 'resolveStemLayerBuffer').mockResolvedValue(buffer);

    try {
      await manager.stemPreviewElements.loadStemAudioElement('clip-stem-preview', key, layer);

      expect(objectUrls.createObjectURL).toHaveBeenCalledOnce();
      const entry = manager.stemPreviewElements.getStemAudioElementEntry('clip-stem-preview', layer.id);
      expect(entry?.element).toBeInstanceOf(HTMLAudioElement);
      expect(entry?.url).toBe('blob:stem-preview-buffer');
      const resource = timelineRuntimeCoordinator
        .getBridgeStats()
        .policies.interactive.resources
        .find((candidate) => candidate.tags?.includes('stem-audio-element'));
      expect(resource).toMatchObject({
        kind: 'html-media',
        policyId: 'interactive',
        mediaElementKind: 'audio',
        srcKind: 'blob-url',
        owner: {
          ownerId: 'audio-track-sync:stem-audio-element:clip-stem-preview',
          ownerType: 'clip',
          clipId: 'clip-stem-preview',
          mediaFileId: 'stem-media',
        },
        source: {
          sourceId: 'vocals',
          mediaFileId: 'stem-media',
          fileHash: 'stem-hash',
        },
        dimensions: {
          durationSeconds: 1.5,
          sampleRate: 44_100,
          channelCount: 2,
        },
      });
      expect(resource?.tags).toEqual(expect.arrayContaining([
        'runtime-provider-demand',
        'lease-visible',
        'stem-audio-element',
      ]));

      manager.stemPreviewElements.disposeStemAudioSet('clip-stem-preview');

      expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:stem-preview-buffer');
      expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: resource?.id })]));
    } finally {
      objectUrls.restore();
    }
  });

  it('denies stem preview buffer audio before creating object URLs or audio elements when the policy is full', async () => {
    for (let index = 0; index < 48; index += 1) {
      timelineRuntimeCoordinator.retainResource(createRetainedInteractiveAudioResource(index));
    }
    const manager = new AudioTrackSyncManager() as unknown as AudioTrackSyncManagerRuntimeTestAccess;
    const layer = makeStemLayer({ id: 'drums', label: 'Drums' });
    const key = 'stem-preview-denied-set';
    const objectUrls = installObjectUrlMocks('blob:should-not-exist');
    const createElement = vi.spyOn(document, 'createElement');
    vi.spyOn(StemAudioSourceResolver.prototype, 'resolveStemLayerBuffer').mockResolvedValue(makeAudioBuffer());

    try {
      await manager.stemPreviewElements.loadStemAudioElement('clip-stem-denied', key, layer);

      const entry = manager.stemPreviewElements.getStemAudioElementEntry('clip-stem-denied', layer.id);
      expect(entry).toMatchObject({
        key,
        element: null,
        loading: false,
        error: 'Stem preview audio budget denied: Drums',
      });
      expect(objectUrls.createObjectURL).not.toHaveBeenCalled();
      expect(createElement).not.toHaveBeenCalledWith('audio');
      expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources)
        .not.toEqual(expect.arrayContaining([
          expect.objectContaining({
            tags: expect.arrayContaining(['stem-audio-element']),
          }),
        ]));
    } finally {
      objectUrls.restore();
    }
  });
});
