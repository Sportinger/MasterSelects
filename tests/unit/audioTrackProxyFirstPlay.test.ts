import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioSyncHandler } from '../../src/services/layerBuilder/AudioSyncHandler';
import { AudioTrackSyncManager } from '../../src/services/layerBuilder/AudioTrackSyncManager';
import type { AudioTrackRuntimeElementManager } from '../../src/services/layerBuilder/audioTrackRuntimeElements';
import { clearMasterAudio } from '../../src/services/layerBuilder/PlayheadState';
import type { AudioSyncState, FrameContext } from '../../src/services/layerBuilder/types';
import { Logger } from '../../src/services/logger';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import {
  getLazyTimelineAudioElementForClip,
  hydrateTimelineMediaWindow,
  releaseAllLazyTimelineMediaElements,
} from '../../src/services/timeline/lazyMediaElements';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

type ManagerAccess = {
  audioSyncHandler: Pick<AudioSyncHandler, 'syncAudioElement' | 'stopScrubAudio'>;
  runtimeElements: AudioTrackRuntimeElementManager;
  syncAudioTrackClips: (ctx: FrameContext, state: AudioSyncState) => void;
};

const MEDIA_ID = 'media-wma';
const WMA_FILE = {
  id: MEDIA_ID,
  name: 'tone.wma',
  url: 'blob:original-wma',
  hasProxyAudio: true,
  audioProxyStatus: 'ready',
};

function makeAudioClip(): TimelineClip {
  return createMockClip({
    id: 'clip-wma',
    trackId: 'audio-track',
    name: 'tone.wma',
    duration: 10,
    outPoint: 10,
    source: { type: 'audio', mediaFileId: MEDIA_ID },
  });
}

function makePlayingContext(clip: TimelineClip): FrameContext {
  const mediaFiles = [WMA_FILE];
  return {
    clips: [clip],
    clipsAtTime: [clip],
    tracks: [],
    videoTracks: [],
    audioTracks: [{ id: 'audio-track', type: 'audio', muted: false }],
    visibleVideoTrackIds: new Set(),
    unmutedAudioTrackIds: new Set(['audio-track']),
    clipsByTrackId: new Map([[clip.trackId, clip]]),
    mediaFiles,
    mediaFileById: new Map(mediaFiles.map(file => [file.id, file])),
    mediaFileByName: new Map(),
    compositionById: new Map(),
    isPlaying: true,
    isDraggingPlayhead: false,
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
  } as unknown as FrameContext;
}

function newSyncState(): AudioSyncState {
  return { audioPlayingCount: 0, maxAudioDrift: 0, hasAudioError: false, masterSet: false } as AudioSyncState;
}

type CacheMethod = 'getCachedAudioProxy' | 'getAudioProxy' | 'getCachedAudioBuffer' | 'warmScrubAudioBuffer';
const cache = proxyFrameCache as unknown as Record<CacheMethod, unknown>;
const originalCacheMethods = new Map<CacheMethod, unknown>();

/** proxyFrameCache is a partial mock in tests/setup.ts, so methods are assigned instead of spied on. */
function stubCache<T extends (...args: never[]) => unknown>(name: CacheMethod, impl: T) {
  if (!originalCacheMethods.has(name)) originalCacheMethods.set(name, cache[name]);
  const fn = vi.fn(impl);
  cache[name] = fn;
  return fn;
}

function proxyWarnings() {
  return Logger.getBuffer('WARN').filter(entry => entry.message.includes('Audio proxy is marked ready'));
}

describe('audio-track playback with a ready audio proxy', () => {
  beforeEach(() => {
    Logger.clear();
    timelineRuntimeCoordinator.clearResources();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    stubCache('getCachedAudioBuffer', () => null);
    stubCache('warmScrubAudioBuffer', async () => null);
    vi.mocked(useMediaStore.getState).mockReturnValue({ files: [WMA_FILE] } as unknown as ReturnType<typeof useMediaStore.getState>);
  });

  afterEach(() => {
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
    vi.mocked(useMediaStore.getState).mockReset();
    vi.restoreAllMocks();
    for (const [name, original] of originalCacheMethods) cache[name] = original;
    originalCacheMethods.clear();
    clearMasterAudio();
  });

  it('stays silent while the proxy loads instead of playing the undecodable original, then plays the proxy', async () => {
    const manager = new AudioTrackSyncManager() as unknown as ManagerAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };
    const sharedProxy = document.createElement('audio');
    sharedProxy.src = 'blob:wav-proxy';
    let cachedProxy: HTMLAudioElement | null = null;
    stubCache('getCachedAudioProxy', () => cachedProxy);
    let resolveLoad: (value: HTMLAudioElement | null) => void = () => undefined;
    const getAudioProxy = stubCache('getAudioProxy',
      () => new Promise<HTMLAudioElement | null>(resolve => { resolveLoad = resolve; }));

    const clip = makeAudioClip();
    const ctx = makePlayingContext(clip);
    hydrateTimelineMediaWindow(ctx);
    const original = getLazyTimelineAudioElementForClip(clip);
    expect(original).toBeInstanceOf(HTMLAudioElement);

    manager.syncAudioTrackClips(ctx, newSyncState());
    manager.syncAudioTrackClips(ctx, newSyncState());

    expect(syncAudioElement).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(getAudioProxy).toHaveBeenCalledTimes(1));

    cachedProxy = sharedProxy;
    resolveLoad(sharedProxy);
    await Promise.resolve();
    manager.syncAudioTrackClips(ctx, newSyncState());

    expect(syncAudioElement).toHaveBeenCalledTimes(1);
    const target = syncAudioElement.mock.calls[0][0];
    expect(target.element).not.toBe(original);
    expect(target.element.src).toBe('blob:wav-proxy');
    expect(proxyWarnings()).toEqual([]);
  });

  it('falls back to the original only after the proxy failed to load, and says so once', async () => {
    const manager = new AudioTrackSyncManager() as unknown as ManagerAccess;
    const syncAudioElement = vi.fn();
    manager.audioSyncHandler = { syncAudioElement, stopScrubAudio: vi.fn() };
    stubCache('getCachedAudioProxy', () => null);
    const getAudioProxy = stubCache('getAudioProxy', async () => null);

    const clip = makeAudioClip();
    const ctx = makePlayingContext(clip);
    hydrateTimelineMediaWindow(ctx);
    const original = getLazyTimelineAudioElementForClip(clip);

    manager.syncAudioTrackClips(ctx, newSyncState());
    expect(syncAudioElement).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(proxyWarnings()).toHaveLength(1));

    manager.syncAudioTrackClips(ctx, newSyncState());
    manager.syncAudioTrackClips(ctx, newSyncState());

    expect(syncAudioElement).toHaveBeenCalledTimes(2);
    expect(syncAudioElement.mock.calls[0][0].element).toBe(original);
    expect(getAudioProxy).toHaveBeenCalledTimes(1);
    expect(proxyWarnings()).toHaveLength(1);
    expect(proxyWarnings()[0].data).toMatchObject({ mediaFileId: MEDIA_ID, reason: 'load-failed' });
  });

  it('reports pending only for media whose proxy is ready', () => {
    const manager = new AudioTrackSyncManager() as unknown as ManagerAccess;
    stubCache('getCachedAudioProxy', () => null);
    stubCache('getAudioProxy', () => new Promise(() => undefined));
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [WMA_FILE, { id: 'media-mp3', name: 'tone.mp3', audioProxyStatus: 'none' }],
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    expect(manager.runtimeElements.resolveAudioTrackProxyForClip(MEDIA_ID, 'clip-a'))
      .toEqual({ element: null, pending: true });
    expect(manager.runtimeElements.resolveAudioTrackProxyForClip('media-mp3', 'clip-b'))
      .toEqual({ element: null, pending: false });
    expect(manager.runtimeElements.resolveAudioTrackProxyForClip(undefined, 'clip-c'))
      .toEqual({ element: null, pending: false });
  });
});
