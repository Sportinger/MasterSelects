import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import { useMediaStore } from '../../src/stores/mediaStore';
import { AudioTrackSyncManager } from '../../src/services/layerBuilder/AudioTrackSyncManager';
import type { AudioTrackCrossfadeTransitionSync, AudioCrossfadeFrame } from '../../src/services/layerBuilder/audioTrackCrossfadeTransitions';
import type { AudioTrackHandoffManager } from '../../src/services/layerBuilder/audioTrackHandoffs';
import type { AudioSyncHandler } from '../../src/services/layerBuilder/AudioSyncHandler';
import type { AudioSyncState, FrameContext } from '../../src/services/layerBuilder/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { installAudioContextMock } from '../helpers/mockAudioContext';

/**
 * Preview crossfades with audio proxies (linked sound with "Include audio"
 * after proxy generation) through the real AudioTrackSyncManager, its proxy
 * clones and the real routing manager on a mock AudioContext.
 */

type ManagerAccess = {
  audioSyncHandler: Pick<AudioSyncHandler, 'syncAudioElement' | 'stopScrubAudio'>;
  crossfadeTransitions: AudioTrackCrossfadeTransitionSync;
  audioHandoffs: AudioTrackHandoffManager;
  runtimeElements: { getAudioTrackProxy: (clipId: string) => HTMLAudioElement | undefined };
  getPlayableSourceAudioElement: (clip: TimelineClip) => HTMLAudioElement | null;
  syncAudioTrackClips: (ctx: FrameContext, state: AudioSyncState, active: Set<string>, frame: AudioCrossfadeFrame) => void;
  pauseInactiveAudio: (ctx: FrameContext, active: Set<string>, frame: AudioCrossfadeFrame) => void;
};

const track = { id: 'a1', type: 'audio', muted: false, visible: true } as TimelineTrack;
const proxyCache = proxyFrameCache as unknown as Record<string, unknown>;

function audioClip(id: string, startTime: number, inPoint: number, mediaFileId: string, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId: 'a1', name: id, startTime, duration: 4, inPoint, outPoint: inPoint + 4, mediaFileId,
    source: { type: 'audio', mediaFileId }, effects: [], file: new File([], `${mediaFileId}.wav`), ...extra,
  } as unknown as TimelineClip;
}

const crossfade = (linkedClipId: string) => ({ id: `x-${linkedClipId}`, type: 'crossfade' as const, duration: 1, linkedClipId, params: {} });

/** a (0–4 s) → b (4–8 s), two proxied sounds, fade 3.5–4.5 s. */
function differentSounds(outgoingExtra: Partial<TimelineClip> = {}): TimelineClip[] {
  return [
    audioClip('a', 0, 2, 'pa', { transitionOut: crossfade('b'), ...outgoingExtra }),
    audioClip('b', 4, 2, 'pb', { transitionIn: crossfade('a') }),
  ];
}

function frameContext(clips: TimelineClip[], playheadPosition: number, isPlaying = true, mediaDuration = 20): FrameContext {
  const clipsAtTime = clips.filter((clip) => playheadPosition >= clip.startTime && playheadPosition < clip.startTime + clip.duration);
  return {
    clips, clipsAtTime, playheadPosition, isPlaying, isDraggingPlayhead: false, playbackSpeed: 1, now: 1000,
    audioTracks: [track], videoTracks: [], tracks: [track],
    unmutedAudioTrackIds: new Set(['a1']),
    clipsByTrackId: new Map(clipsAtTime.map((clip) => [clip.trackId, clip])),
    mediaFileById: new Map(clips.map((clip) => [clip.mediaFileId, { duration: mediaDuration }])),
    getInterpolatedEffects: () => [],
    getInterpolatedSpeed: () => 1,
    getSourceTimeForClip: (_clipId: string, localTime: number) => localTime,
    getClipKeyframes: () => [],
    hasKeyframes: () => false,
  } as unknown as FrameContext;
}

/** One sync pass in the order of AudioTrackSyncManager.syncAudioElements. */
function runFrame(manager: ManagerAccess, ctx: FrameContext): AudioCrossfadeFrame {
  const frame = manager.crossfadeTransitions.planFrame(ctx);
  const crossfades = {
    overrides: frame.handoffOverrides,
    blocksHandoff: (previous: string, clip: TimelineClip) => manager.crossfadeTransitions.blocksHandoff(ctx, previous, clip),
  };
  const element = (clip: TimelineClip) => manager.getPlayableSourceAudioElement(clip);
  const fileId = (clip: TimelineClip) => clip.mediaFileId;
  if (ctx.isPlaying) manager.audioHandoffs.compute(ctx, element, fileId, crossfades);
  const active = new Set<string>();
  manager.syncAudioTrackClips(ctx, { masterSet: false } as AudioSyncState, active, frame);
  manager.pauseInactiveAudio(ctx, active, frame);
  if (ctx.isPlaying) manager.audioHandoffs.updateLastTrackState(ctx, element, fileId, crossfades);
  return frame;
}

/** Lets the routing manager finish routes it is still building. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('preview crossfade with audio proxies', () => {
  const originalAudioContext = globalThis.AudioContext;
  let manager: ManagerAccess;
  let synced: HTMLMediaElement[];

  beforeEach(() => {
    audioRoutingManager.dispose();
    installAudioContextMock();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const shared = new Map(['pa', 'pb', 'long'].map((id) => {
      const element = document.createElement('audio');
      element.src = `blob:proxy-${id}`;
      return [id, element];
    }));
    proxyCache.getCachedAudioProxy = vi.fn((mediaFileId: string) => shared.get(mediaFileId) ?? null);
    proxyCache.preloadAudioProxy = vi.fn();
    (useMediaStore.getState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      files: [...shared.keys()].map((id) => ({ id, name: `${id}.wav`, hasProxyAudio: true, audioProxyStatus: 'ready' })),
    });
    manager = new AudioTrackSyncManager() as unknown as ManagerAccess;
    synced = [];
    // Plays nothing, but routes every synced element as the real handler does while playing.
    manager.audioSyncHandler = {
      syncAudioElement: vi.fn((target) => {
        synced.push(target.element);
        // A playing element is where it was synced to (a cut handoff checks that).
        Object.defineProperty(target.element, 'currentTime', { value: target.clipTime, writable: true, configurable: true });
        void audioRoutingManager.applyEffects(target.element, target.volume ?? 1, target.eqGains ?? [], target.pan, target.processors, target.masterRoute);
      }),
      stopScrubAudio: vi.fn(),
    } as unknown as ManagerAccess['audioSyncHandler'];
  });

  afterEach(() => {
    audioRoutingManager.dispose();
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    if (originalAudioContext) globalScope.AudioContext = originalAudioContext;
    else delete globalScope.AudioContext;
    delete proxyCache.getCachedAudioProxy;
    delete proxyCache.preloadAudioProxy;
    vi.restoreAllMocks();
  });

  it('prepares the incoming proxy once and keeps it routed until its window', async () => {
    const clips = differentSounds();
    const proxies = new Set<HTMLAudioElement>();
    for (const time of [2.6, 2.7, 2.8, 2.9, 3.0]) {
      const frame = runFrame(manager, frameContext(clips, time));
      expect(frame.preparedClipIds.has('b')).toBe(true);
      proxies.add(manager.runtimeElements.getAudioTrackProxy('b')!);
      await settle();
    }
    // One clone, one route: no dangling graph per frame (the other route is a's, playing).
    expect(proxies.size).toBe(1);
    const [prepared] = proxies;
    expect(audioRoutingManager.hasRoute(prepared)).toBe(true);
    expect(audioRoutingManager.hasRoute(manager.runtimeElements.getAudioTrackProxy('a')!)).toBe(true);
    expect(audioRoutingManager.activeRouteCount).toBe(2);

    // The window plays the incoming voice on exactly that element.
    synced.length = 0;
    runFrame(manager, frameContext(clips, 3.3));
    expect(synced).toContain(prepared);
  });

  it('disposes the route of a proxy nobody plays any more', async () => {
    const clips = differentSounds();
    runFrame(manager, frameContext(clips, 2.6));
    await settle();
    const prepared = manager.runtimeElements.getAudioTrackProxy('b')!;
    expect(audioRoutingManager.hasRoute(prepared)).toBe(true);
    // Stopped before the window: nothing is prepared, the clone and its graph go.
    runFrame(manager, frameContext(clips, 2.6, false));
    expect(manager.runtimeElements.getAudioTrackProxy('b')).toBeUndefined();
    expect(audioRoutingManager.hasRoute(prepared)).toBe(false);
    // Only a's route is left: a is at the playhead.
    expect(audioRoutingManager.activeRouteCount).toBe(1);
  });

  it('only pauses the outgoing proxy while its echo rings after the window', async () => {
    const echo = { audioState: { effectStack: [{ id: 'echo', descriptorId: 'audio-delay', enabled: true, params: { delayMs: 500, feedback: 0.5, mix: 1 } }] } };
    const clips = differentSounds(echo as Partial<TimelineClip>);
    runFrame(manager, frameContext(clips, 4.2));
    await settle();
    const outgoing = manager.runtimeElements.getAudioTrackProxy('a')!;
    expect(audioRoutingManager.hasRoute(outgoing)).toBe(true);
    const frame = runFrame(manager, frameContext(clips, 4.7));
    expect(frame.tailElements.has(outgoing)).toBe(true);
    expect(manager.runtimeElements.getAudioTrackProxy('a')).toBe(outgoing);
    expect(audioRoutingManager.hasRoute(outgoing)).toBe(true);
    // Once the tail has rung out the proxy is released with its route.
    runFrame(manager, frameContext(clips, 4.5 + 15));
    expect(manager.runtimeElements.getAudioTrackProxy('a')).toBeUndefined();
    expect(audioRoutingManager.hasRoute(outgoing)).toBe(false);
  });

  it('keeps the proxy a split recording continues on after its window', async () => {
    const clips = [
      audioClip('a', 0, 1, 'long', { transitionOut: crossfade('b') }),
      audioClip('b', 4, 5, 'long', { transitionIn: crossfade('a') }),
    ];
    runFrame(manager, frameContext(clips, 3.4));
    await settle();
    const voice = manager.runtimeElements.getAudioTrackProxy('a')!;
    for (const time of [3.6, 4.2, 4.6, 4.8]) {
      synced.length = 0;
      runFrame(manager, frameContext(clips, time));
      // One voice inside the fade, then b plays on through the same element.
      expect(synced).toEqual([voice]);
      expect(manager.runtimeElements.getAudioTrackProxy('a')).toBe(voice);
    }
    expect(audioRoutingManager.hasRoute(voice)).toBe(true);
  });

  it('keeps the echo ringing on the proxy a cut handoff passed to the outgoing clip', async () => {
    // A | B one recording split with a plain cut (B continues on A's proxy), then B → C with Echo on B.
    const echo = { audioState: { effectStack: [{ id: 'echo', descriptorId: 'audio-delay', enabled: true, params: { delayMs: 500, feedback: 0.5, mix: 1 } }] } };
    const clips = [
      audioClip('A', 0, 0, 'long'),
      audioClip('B', 4, 4, 'long', { transitionOut: crossfade('C'), ...echo } as Partial<TimelineClip>),
      audioClip('C', 8, 2, 'pb', { transitionIn: crossfade('B') }),
    ];
    for (const time of [3.0, 3.5, 3.9, 4.05, 4.2, 5, 6, 7.0, 7.3, 7.6, 8.0, 8.3, 8.45]) {
      runFrame(manager, frameContext(clips, time, true, 40));
      await settle();
    }
    const handoffProxy = manager.runtimeElements.getAudioTrackProxy('A')!;
    // B played on A's proxy before and inside its crossfade.
    expect(audioRoutingManager.hasRoute(handoffProxy)).toBe(true);
    const tail = runFrame(manager, frameContext(clips, 8.7, true, 40));
    await settle();
    expect(tail.tailElements.has(handoffProxy)).toBe(true);
    expect(manager.runtimeElements.getAudioTrackProxy('A')).toBe(handoffProxy);
    expect(audioRoutingManager.hasRoute(handoffProxy)).toBe(true);
    // Once the echo has rung out the proxy goes with its route.
    runFrame(manager, frameContext(clips, 8.5 + 15, true, 40));
    expect(manager.runtimeElements.getAudioTrackProxy('A')).toBeUndefined();
    expect(audioRoutingManager.hasRoute(handoffProxy)).toBe(false);
  });
});
