import { beforeEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({
  routed: new Set<unknown>(),
  applyEffects: vi.fn(async () => true),
  syncCutFades: vi.fn(),
}));
// Lets a test replace the live route of a clip; every other test uses the real settings.
const routeOverride = vi.hoisted(() => ({
  current: null as null | ((input: { clip: { id: string } }) => unknown),
}));
vi.mock('../../src/services/audio/audioGraphRouteSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/audio/audioGraphRouteSettings')>();
  return {
    ...actual,
    createLiveAudioRouteSettings: (input: Parameters<typeof actual.createLiveAudioRouteSettings>[0]) =>
      (routeOverride.current?.(input) as ReturnType<typeof actual.createLiveAudioRouteSettings> | undefined)
        ?? actual.createLiveAudioRouteSettings(input),
  };
});
vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: {
    hasRoute: (element: unknown) => routing.routed.has(element),
    applyEffects: routing.applyEffects,
    syncCutFades: routing.syncCutFades,
  },
}));

import { hasAudioCrossfadeEdge, planAudioCrossfadeFromClip, type AudioCrossfadePair } from '../../src/services/audio/audioCrossfadePlanning';
import {
  AUDIO_CROSSFADE_PREROLL_SECONDS,
  addAudioCrossfadeEdgeClips,
  planAudioCrossfadePreviewWindow,
} from '../../src/services/audio/audioCrossfadePreviewVoices';
import { getTransitionAudioEnvelopeGain } from '../../src/services/audio/audioCrossfadeGains';
import { getScheduledEdgeGainAt, scheduleAutomaticCutFades } from '../../src/services/audio/automaticCutFadePlayback';
import { createAutomaticCutDeClickOperation } from '../../src/services/audio/automaticCutDeClick';
import { syncMediaCutFades } from '../../src/services/audio/routing/mediaCutFades';
import { AudioTrackCrossfadeTransitionSync } from '../../src/services/layerBuilder/audioTrackCrossfadeTransitions';
import { AudioTrackHandoffManager } from '../../src/services/layerBuilder/audioTrackHandoffs';
import { AudioTrackPrebufferManager } from '../../src/services/layerBuilder/audioTrackPrebuffering';
import type { AudioSyncState, AudioSyncTarget, FrameContext } from '../../src/services/layerBuilder/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const MEDIA_DURATION = 20;
const track = { id: 'a1', type: 'audio', muted: false, visible: true } as TimelineTrack;

function audioClip(id: string, startTime: number, inPoint: number, mediaFileId: string, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId: 'a1', name: id, startTime, duration: 4, inPoint, outPoint: inPoint + 4,
    mediaFileId, source: { type: 'audio', mediaFileId }, effects: [], file: new File([], `${mediaFileId}.wav`), ...extra,
  } as unknown as TimelineClip;
}

function crossfade(linkedClipId: string, params: Record<string, unknown> = {}) {
  return { id: `x-${linkedClipId}`, type: 'crossfade' as const, duration: 1, linkedClipId, params };
}

/** a (0–4 s) → b (4–8 s), a 1 s centred crossfade (fade 3.5–4.5 s). */
function differentSounds(): TimelineClip[] {
  return [
    audioClip('a', 0, 2, 'pink-a', { transitionOut: crossfade('b') }),
    audioClip('b', 4, 2, 'pink-b', { transitionIn: crossfade('a') }),
  ];
}

/** One recording split at 4 s: b continues a's source exactly. */
function splitRecording(params: Record<string, unknown> = {}): TimelineClip[] {
  return [
    audioClip('a', 0, 1, 'long', { transitionOut: crossfade('b', params) }),
    audioClip('b', 4, 5, 'long', { transitionIn: crossfade('a', params) }),
  ];
}

function plan(clips: TimelineClip[]): AudioCrossfadePair {
  return planAudioCrossfadeFromClip(clips[0], clips, { getMediaDuration: () => MEDIA_DURATION })!;
}

interface FrameOptions {
  now?: number;
  /** Media durations by media file id (default MEDIA_DURATION). */
  durations?: Record<string, number>;
  getInterpolatedEffects?: (clipId: string, localTime: number) => unknown[];
}

function frameContext(clips: TimelineClip[], playheadPosition: number, isPlaying = true, options: FrameOptions = {}): FrameContext {
  return {
    clips,
    playheadPosition,
    audioTracks: [track],
    isPlaying,
    isDraggingPlayhead: false,
    now: options.now ?? 1000,
    mediaFileById: new Map(clips.map((clip) => [clip.mediaFileId, { duration: options.durations?.[clip.mediaFileId!] ?? MEDIA_DURATION }])),
    unmutedAudioTrackIds: new Set(['a1']),
    getInterpolatedEffects: options.getInterpolatedEffects ?? (() => []),
    getClipKeyframes: () => [],
    clipsAtTime: clips.filter((clip) => playheadPosition >= clip.startTime && playheadPosition < clip.startTime + clip.duration),
    clipsByTrackId: new Map(clips
      .filter((clip) => playheadPosition >= clip.startTime && playheadPosition < clip.startTime + clip.duration)
      .map((clip) => [clip.trackId, clip])),
  } as unknown as FrameContext;
}

function mediaElement(name: string, extra: Partial<HTMLAudioElement> = {}): HTMLAudioElement {
  return { name, src: `blob:${name}`, readyState: 4, paused: true, currentTime: 0, pause: vi.fn(), ...extra } as unknown as HTMLAudioElement;
}

function createSync(
  elements: Record<string, HTMLAudioElement>,
  synced: AudioSyncTarget[] = [],
  extraDeps: Partial<ConstructorParameters<typeof AudioTrackCrossfadeTransitionSync>[0]> = {},
) {
  return new AudioTrackCrossfadeTransitionSync({
    ...extraDeps,
    getClipAudioElement: (clip) => elements[clip.id] ?? null,
    getAudioProxyElementForClip: () => null,
    getClipSourceMediaFileId: (clip) => clip.mediaFileId,
    isAudioSourceClip: (clip) => clip.source?.type === 'audio',
    pauseAudioTrackProxy: vi.fn(),
    stopStemBufferMixer: vi.fn(),
    pauseStemAudioElements: vi.fn(),
    syncPreviewAudioElement: (target) => { synced.push(target); },
    ...extraDeps,
  });
}

function syncWindow(sync: AudioTrackCrossfadeTransitionSync, ctx: FrameContext) {
  const frame = sync.planFrame(ctx);
  const window = frame.windows.get('a1');
  if (window) sync.sync({ ctx, state: { masterSet: false } as AudioSyncState, track, window, activeTransitionAudioClipIds: new Set(), regionGainPreview: null });
  return frame;
}

beforeEach(() => {
  routeOverride.current = null;
  routing.routed.clear();
  routing.applyEffects.mockClear();
  routing.syncCutFades.mockClear();
});

describe('preview audio crossfade voices', () => {
  it('starts the incoming sound early and silent, and fades both on their own gain ramps', () => {
    const window = planAudioCrossfadePreviewWindow(plan(differentSounds()), { singleVoice: false })!;
    expect(window.start).toBeCloseTo(3.5 - AUDIO_CROSSFADE_PREROLL_SECONDS);
    expect(window.end).toBeCloseTo(4.5);
    const [outgoing, incoming] = window.voices.map((voice) => voice.voiceClip);
    expect(outgoing).toMatchObject({ id: 'a', startTime: window.start, inPoint: 2 + window.start });
    expect(outgoing.outPoint).toBeCloseTo(6.5);
    expect(outgoing.transitionAudioEnvelopes?.[0]).toMatchObject({ role: 'outgoing', curve: 'equal-power', sourceStart: 5.5, sourceEnd: 6.5 });
    // b's source 1.25 s is its head handle 0.75 s before its in point.
    expect(incoming).toMatchObject({ id: 'b', startTime: window.start, inPoint: 2 - (4 - window.start) });
    expect(incoming.transitionAudioEnvelopes?.[0]).toMatchObject({ role: 'incoming', sourceStart: 1.5, sourceEnd: 2.5 });
    expect(getScheduledEdgeGainAt(incoming, incoming.inPoint)).toBe(0);
    expect(getTransitionAudioEnvelopeGain(incoming.transitionAudioEnvelopes![0], 2)).toBeCloseTo(Math.SQRT1_2);
    // b keeps its own element after the fade.
    expect(window.continuesOn.elementClip.id).toBe('b');
  });

  it('clamps the preroll where the incoming media starts', () => {
    const clips = differentSounds();
    clips[1] = { ...clips[1], inPoint: 0.6, outPoint: 4.6 };
    const window = planAudioCrossfadePreviewWindow(plan(clips), { singleVoice: false })!;
    expect(window.start).toBeCloseTo(3.5 - 0.1);
    expect(window.voices[1].voiceClip.inPoint).toBeCloseTo(0);
  });

  it('plays one split recording once with both gains added and continues on that element', () => {
    const pair = plan(splitRecording());
    expect(pair.continuousSource).toBe(true);
    // Auto (the default and any saved crossfade without a curve) is Equal gain here.
    expect(pair.fade.curve).toBe('equal-gain');
    expect(plan(differentSounds()).fade.curve).toBe('equal-power');
    expect(plan(splitRecording({ audioCurve: 'equal-power' })).fade.curve).toBe('equal-power');

    const window = planAudioCrossfadePreviewWindow(pair, { singleVoice: true })!;
    expect(window.voices).toHaveLength(1);
    const [{ clip, voiceClip }] = window.voices;
    expect(clip.id).toBe('a');
    expect(voiceClip.transitionAudioEnvelopes?.[0]?.role).toBe('sum');
    for (const time of [5.5, 5.8, 6, 6.4]) expect(getScheduledEdgeGainAt(voiceClip, time)).toBeCloseTo(1, 9);
    expect(window.continuesOn).toMatchObject({ clip: { id: 'b' }, elementClip: { id: 'a' } });
    const power = planAudioCrossfadePreviewWindow(plan(splitRecording({ audioCurve: 'equal-power' })), { singleVoice: true })!;
    expect(getScheduledEdgeGainAt(power.voices[0].voiceClip, 5)).toBeCloseTo(Math.SQRT2);
  });

  it('gives clips that meet at the edit their de-click in source seconds', () => {
    const clips = differentSounds();
    clips[0] = { ...clips[0], inPoint: 16, outPoint: MEDIA_DURATION };
    clips[1] = { ...clips[1], inPoint: 0, outPoint: 4 };
    const pair = plan(clips);
    expect(pair.fade.kind).toBe('declick');
    expect(planAudioCrossfadePreviewWindow(pair, { singleVoice: false })).toBeNull();
    const edgeClips = new Map<string, TimelineClip>();
    addAudioCrossfadeEdgeClips(edgeClips, pair);
    const [outgoing, incoming] = [edgeClips.get('a')!, edgeClips.get('b')!];
    expect(outgoing.transitionAudioEnvelopes?.[0]).toMatchObject({ role: 'outgoing', sourceEnd: MEDIA_DURATION });
    expect(MEDIA_DURATION - outgoing.transitionAudioEnvelopes![0].sourceStart).toBeCloseTo(0.005);
    expect(incoming.transitionAudioEnvelopes?.[0]).toMatchObject({ role: 'incoming', sourceStart: 0 });
  });
});

describe('preview crossfade sync', () => {
  it('keeps the gain ramp off the level while playing, so no element pauses at gain 0', () => {
    const elements = { a: mediaElement('a', { paused: false }), b: mediaElement('b') };
    const synced: AudioSyncTarget[] = [];
    const sync = createSync(elements, synced);
    const ctx = frameContext(differentSounds(), 3.3);
    const window = sync.planFrame(ctx).windows.get('a1')!;
    sync.sync({ ctx, state: { masterSet: false } as AudioSyncState, track, window, activeTransitionAudioClipIds: new Set(), regionGainPreview: null });
    expect(synced.map((target) => [target.clip.id, target.volume, target.isMuted])).toEqual([['a', 1, false], ['b', 1, false]]);
    // The incoming element plays its head handle 0.2 s before the fade, at gain 0 on its route.
    expect(synced[1].clipTime).toBeCloseTo(2 - 0.7);
    expect(getScheduledEdgeGainAt(synced[1].clip, synced[1].clipTime)).toBe(0);
  });

  it('positions the incoming element before the window and keeps prebuffering away from it', () => {
    const elements = { a: mediaElement('a', { paused: false }), b: mediaElement('b', { currentTime: 2 }) };
    const sync = createSync(elements);
    const ctx = frameContext(differentSounds(), 2.6);
    const frame = sync.planFrame(ctx);
    expect(frame.windows.size).toBe(0);
    expect([...frame.preparedClipIds]).toEqual(['b']);
    expect(elements.b.currentTime).toBeCloseTo(2 - 0.75);
    expect(routing.applyEffects).toHaveBeenCalledTimes(1);
    expect(sync.isPrepared('b')).toBe(true);

    const prebuffer = new AudioTrackPrebufferManager({
      getAudioProxyElementForClip: () => null,
      getClipAudioElement: (clip) => elements[clip.id as 'a' | 'b'] ?? null,
      stemBufferMixers: {} as never,
      stemPreviewElements: {} as never,
      isPreparedElsewhere: (clipId) => sync.isPrepared(clipId),
    });
    prebuffer.preBufferUpcomingAudio(frameContext(differentSounds(), 3.2));
    expect(elements.b.currentTime).toBeCloseTo(1.25);
  });

  it('never moves a playing element while prebuffering', () => {
    const playing = mediaElement('b', { paused: false, currentTime: 1.5 });
    const prebuffer = new AudioTrackPrebufferManager({
      getAudioProxyElementForClip: () => null,
      getClipAudioElement: () => playing,
      stemBufferMixers: {} as never,
      stemPreviewElements: {} as never,
    });
    prebuffer.preBufferUpcomingAudio(frameContext(differentSounds(), 3.6));
    expect(playing.currentTime).toBe(1.5);
  });
});

describe('effect tails after a preview crossfade', () => {
  it('keeps the outgoing route connected while its echo rings, then lets it go', () => {
    const clips = differentSounds();
    clips[0] = {
      ...clips[0],
      audioState: { effectStack: [{ id: 'echo', descriptorId: 'audio-delay', enabled: true, params: { time: 0.5, feedback: 0.5, mix: 1 } }] },
    } as TimelineClip;
    const elements = { a: mediaElement('a', { paused: false }), b: mediaElement('b') };
    const sync = createSync(elements);
    // The window played a's voice on its element; that element keeps ringing afterwards.
    sync.planFrame(frameContext(clips, 4.2));
    expect([...sync.planFrame(frameContext(clips, 4.6)).tailElements]).toEqual([elements.a]);
    expect(sync.planFrame(frameContext(clips, 4.5 + 30)).tailElements.size).toBe(0);
    // Without an effect there is nothing to ring.
    const plain = createSync(elements);
    plain.planFrame(frameContext(differentSounds(), 4.2));
    expect(plain.planFrame(frameContext(differentSounds(), 4.6)).tailElements.size).toBe(0);
  });
});

describe('cut handoffs around a crossfade', () => {
  const getElement = (elements: Record<string, HTMLAudioElement>) => (clip: TimelineClip) => elements[clip.id] ?? null;
  const getFileId = (clip: TimelineClip) => clip.mediaFileId;

  function playAcross(clips: TimelineClip[], elements: Record<string, HTMLAudioElement>, times: number[]) {
    const handoffs = new AudioTrackHandoffManager();
    const sync = createSync(elements);
    for (const time of times) {
      const ctx = frameContext(clips, time);
      const frame = sync.planFrame(ctx);
      const crossfades = { overrides: frame.handoffOverrides, blocksHandoff: (previous: string, clip: TimelineClip) => sync.blocksHandoff(ctx, previous, clip) };
      handoffs.compute(ctx, getElement(elements), getFileId, crossfades);
      handoffs.updateLastTrackState(ctx, getElement(elements), getFileId, crossfades);
    }
    return handoffs;
  }

  it('makes no cut handoff for two sounds of one file joined by a crossfade', () => {
    // Same file, a word removed: b starts 0.05 s later in the recording, so both sounds play.
    const clips = splitRecording();
    clips[1] = { ...clips[1], inPoint: 5.05, outPoint: 9.05 };
    const elements = { a: mediaElement('a', { currentTime: 5 }), b: mediaElement('b') };
    expect(plan(clips).continuousSource).toBe(false);
    const handoffs = playAcross(clips, elements, [3, 3.4, 4.1, 4.6, 4.7]);
    expect(handoffs.getHandoffAudioElement('b')).toBeNull();
    // Even when no sync pass saw the crossfade, the cut handoff is vetoed.
    expect(playAcross(clips, elements, [3.0, 4.7]).getHandoffAudioElement('b')).toBeNull();
  });

  it('continues a split recording on the element that played it across the fade', () => {
    const elements = { a: mediaElement('a', { currentTime: 5 }), b: mediaElement('b') };
    const handoffs = playAcross(splitRecording(), elements, [3, 3.6, 4.2, 4.6]);
    expect(handoffs.getHandoffAudioElement('b')).toBe(elements.a);
  });
});

describe('scheduled crossfade gain', () => {
  it('ramps the incoming voice on the audio clock and starts a paused element at gain 0', () => {
    const window = planAudioCrossfadePreviewWindow(plan(differentSounds()), { singleVoice: false })!;
    const incoming = window.voices[1].voiceClip;
    const events: Array<{ value: number; time: number }> = [];
    const gain = {
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn((value: number, time: number) => events.push({ value, time })),
      linearRampToValueAtTime: vi.fn((value: number, time: number) => events.push({ value, time })),
    } as unknown as AudioParam;
    scheduleAutomaticCutFades(gain, incoming, incoming.inPoint, 10);
    expect(events[0]).toEqual({ value: 0, time: 10 });
    const mid = events.find((event) => Math.abs(event.time - 10.75) < 1e-6);
    expect(mid?.value).toBeCloseTo(Math.SQRT1_2, 6);
    expect(events.at(-1)?.value).toBeCloseTo(1, 9);

    const element = { currentTime: incoming.inPoint, playbackRate: 1, paused: true, seeking: false } as HTMLMediaElement;
    syncMediaCutFades(gain, { currentTime: 20 } as AudioContext, element, incoming);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 20);
  });
});

/** a (0–4 s) | b (4–4.8 s) | c (4.8 s–), different sounds, two 0.8 s crossfades: fades 3.6–4.4 s and 4.4–5.2 s. */
function shortMiddleClip(): TimelineClip[] {
  const fade = (id: string, linkedClipId: string) => ({ id, type: 'crossfade' as const, duration: 0.8, linkedClipId, params: {} });
  return [
    audioClip('a', 0, 2, 'pa', { transitionOut: fade('x-ab', 'b') }),
    audioClip('b', 4, 5, 'pb', { duration: 0.8, outPoint: 5.8, transitionIn: fade('x-ab', 'a'), transitionOut: fade('x-bc', 'c') }),
    audioClip('c', 4.8, 2, 'pc', { transitionIn: fade('x-bc', 'b') }),
  ];
}

describe('crossfades on both edges of one clip', () => {
  it('plays one window per track: the later pre-roll waits until the earlier window has ended', () => {
    const clips = shortMiddleClip();
    const elements = { a: mediaElement('a', { paused: false }), b: mediaElement('b', { paused: false }), c: mediaElement('c') };
    const synced: AudioSyncTarget[] = [];
    const sync = createSync(elements, synced);
    // 4.3 s is inside a → b and where b → c's pre-roll alone would start (4.15 s).
    const frame = syncWindow(sync, frameContext(clips, 4.3));
    const first = frame.windows.get('a1')!;
    expect(first.pair.incomingClip.id).toBe('b');
    expect(first.end).toBeCloseTo(4.4);
    // a keeps fading out (no hard cut), c waits silent and positioned for 4.4 s.
    expect(synced.map((target) => target.clip.id)).toEqual(['a', 'b']);
    expect(frame.preparedClipIds.has('c')).toBe(true);
    expect(elements.c.currentTime).toBeCloseTo(2 - (4.8 - 4.4));

    const second = sync.planFrame(frameContext(clips, 4.41)).windows.get('a1')!;
    expect(second.pair.incomingClip.id).toBe('c');
    expect(second.start).toBeCloseTo(4.4);
    for (const voice of second.voices) expect(voice.voiceClip.startTime).toBeCloseTo(4.4);
  });

  it('keeps the de-click of both edges on a short clip without extra sound', () => {
    const clips = [
      audioClip('a', 0, 16, 'pa', { transitionOut: crossfade('b') }),
      audioClip('b', 4, 0, 'pb', { duration: 0.5, outPoint: 0.5, transitionIn: crossfade('a'), transitionOut: crossfade('c') }),
      audioClip('c', 4.5, 0, 'pc', { transitionIn: crossfade('b') }),
    ];
    const frame = createSync({}).planFrame(frameContext(clips, 4.25, true, { durations: { pb: 0.5 } }));
    expect(frame.windows.size).toBe(0);
    const b = frame.edgeClips.get('b')!;
    expect(b.transitionAudioEnvelopes).toHaveLength(2);
    expect(getScheduledEdgeGainAt(b, 0)).toBeCloseTo(0, 9);
    expect(getScheduledEdgeGainAt(b, 0.25)).toBe(1);
    expect(getScheduledEdgeGainAt(b, 0.5)).toBeCloseTo(0, 9);
  });

  it('plays the incoming clip without its cut de-click after the window, as export does', () => {
    const clips = differentSounds();
    const deClick = createAutomaticCutDeClickOperation(clips[1], 'in', 0.012, { createdAt: 0, id: 'de-click-b' })!;
    clips[1] = { ...clips[1], audioState: { editStack: [deClick] } } as TimelineClip;
    expect(getScheduledEdgeGainAt(clips[1], 2.003)).toBeLessThan(1);
    const frame = createSync({}).planFrame(frameContext(clips, 4.6));
    expect(frame.windows.size).toBe(0);
    expect(getScheduledEdgeGainAt(frame.edgeClips.get('b')!, 2.003)).toBe(1);
  });
});

describe('voice levels and elements', () => {
  it('moves the ramp to the level while a voice route is missing, and back once it exists', () => {
    const elements = { a: mediaElement('a', { paused: false }), b: mediaElement('b', { paused: false }) };
    const synced: AudioSyncTarget[] = [];
    const sync = createSync(elements, synced);
    const volumesAt = (now: number) => {
      synced.length = 0;
      syncWindow(sync, frameContext(differentSounds(), 3.6, true, { now }));
      return synced.map((target) => target.volume ?? 1);
    };
    expect(volumesAt(1000)).toEqual([1, 1]);
    // Still unrouted 300 ms after the request: the route failed, the level fades instead.
    const [outgoing, incoming] = volumesAt(1300);
    expect(outgoing).toBeGreaterThan(0.9);
    expect(outgoing).toBeLessThan(1);
    expect(incoming).toBeGreaterThan(0);
    expect(incoming).toBeLessThan(0.3);
    expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1, 6);
    routing.routed.add(elements.a);
    routing.routed.add(elements.b);
    expect(volumesAt(1400)).toEqual([1, 1]);
  });

  it('keeps the outgoing sound on the element it already plays on for the whole window', () => {
    const handoff = mediaElement('handoff of a', { paused: false });
    const elements = { a: mediaElement('a'), b: mediaElement('b') };
    let lastPlayed: HTMLAudioElement | null = handoff;
    const synced: AudioSyncTarget[] = [];
    const sync = createSync(elements, synced, { getLastPlayedElement: (_trackId, clipId) => (clipId === 'a' ? lastPlayed : null) });
    const frame = syncWindow(sync, frameContext(differentSounds(), 3.6));
    expect(synced[0]).toMatchObject({ clip: { id: 'a' }, element: handoff });
    // Nothing else pauses or removes it meanwhile.
    expect(frame.handoffOverrides.get('a1')?.retainedElements).toEqual([handoff, elements.b]);
    // The handoff state now names the window's clip; the voice stays put.
    lastPlayed = null;
    synced.length = 0;
    syncWindow(sync, frameContext(differentSounds(), 3.8));
    expect(synced[0].element).toBe(handoff);
  });
});

describe('one voice or two for a split recording', () => {
  const voicesAt = (sync: AudioTrackCrossfadeTransitionSync, clips: TimelineClip[], time: number, options?: FrameOptions) =>
    sync.planFrame(frameContext(clips, time, true, options)).windows.get('a1')!.voices.length;

  it('decides once from the edit, so keyframed volume cannot flip the voices mid-fade', () => {
    // a fades 1 → 0.6 over its length, b continues 0.6 → 0.2: equal only at the edit.
    const volume = (clipId: string, localTime: number) => clipId === 'a'
      ? 1 - 0.1 * Math.min(4, localTime)
      : 0.6 - 0.1 * Math.max(0, localTime);
    const options: FrameOptions = {
      getInterpolatedEffects: (clipId, localTime) => [
        { id: `volume-${clipId}`, type: 'audio-volume', enabled: true, params: { volume: volume(clipId, localTime) } },
      ],
    };
    const clips = splitRecording();
    const sync = createSync({ a: mediaElement('a', { paused: false }), b: mediaElement('b') });
    for (const time of [3.55, 3.9, 4.2, 4.45]) {
      expect(voicesAt(sync, clips, time, options)).toBe(1);
      expect(sync.blocksHandoff(frameContext(clips, time, true, options), 'a', clips[1])).toBe(false);
    }
  });

  it('decides once while the clips and keyframes stay the same', () => {
    let routes = 0;
    routeOverride.current = () => { routes += 1; return undefined; };
    const clips = splitRecording();
    const sync = createSync({ a: mediaElement('a', { paused: false }) });
    // frameContext hands out a new empty keyframe list per call, as the store does.
    for (const time of [3.6, 3.8, 4.0, 4.2]) {
      voicesAt(sync, clips, time);
      sync.blocksHandoff(frameContext(clips, time), 'a', clips[1]);
    }
    // One route per side at the edit, computed on the first frame only.
    expect(routes).toBe(2);
  });

  it('ignores ids nested in the route settings, but not a real difference', () => {
    const route = (bandId: string, gainDb: number) => ({
      volume: 1, eqGains: [], pan: 0, muted: false,
      processors: [{ id: `eq-${bandId}`, type: 'dynamic-eq-band', band: { id: `band-${bandId}`, gainDb } }],
    });
    routeOverride.current = ({ clip }) => route(clip.id, 3);
    expect(voicesAt(createSync({ a: mediaElement('a', { paused: false }) }), splitRecording(), 4.2)).toBe(1);
    routeOverride.current = ({ clip }) => route('same', clip.id === 'a' ? 3 : 6);
    expect(voicesAt(createSync({ a: mediaElement('a', { paused: false }) }), splitRecording(), 4.2)).toBe(2);
  });
});

describe('cut fade scheduling on a running element', () => {
  function recordGain() {
    const values: number[] = [];
    const gain = {
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn((value: number) => values.push(value)),
      linearRampToValueAtTime: vi.fn(),
    } as unknown as AudioParam;
    return { gain, values };
  }

  it('starts a cold element with its short attack, but keeps the level when a running one moves on to the next clip', () => {
    // A plain split without a crossfade: b continues a's element (a cut handoff).
    const [a, b] = splitRecording().map((clip) => ({
      ...clip,
      transitionIn: undefined,
      transitionOut: undefined,
      audioState: { editStack: [createAutomaticCutDeClickOperation(clip, 'out', 0.012, { createdAt: 0, id: `de-click-${clip.id}` })!] },
    } as TimelineClip));
    const { gain, values } = recordGain();
    const element = { currentTime: 3, playbackRate: 1, paused: false, seeking: false } as HTMLMediaElement;
    // The first scheduled value is where the gain starts.
    syncMediaCutFades(gain, { currentTime: 10 } as AudioContext, element, a);
    expect(values[0]).toBe(0);
    const handoffStart = values.length;
    element.currentTime = 5;
    syncMediaCutFades(gain, { currentTime: 12 } as AudioContext, element, b);
    expect(values[handoffStart]).toBe(1);
  });
});

describe('clips kept off the source buffer mixer', () => {
  it('counts only crossfades that blend sound', () => {
    const sound = audioClip('sound', 0, 0, 'pa', { linkedClipId: 'video' });
    const video = (params: Record<string, unknown>) => ({
      ...audioClip('video', 0, 0, 'pa', { linkedClipId: 'sound', transitionOut: crossfade('next', params) }),
      trackId: 'v1', source: { type: 'video', mediaFileId: 'pa' },
    } as unknown as TimelineClip);
    // A purely visual Crossfade of the linked video leaves the sound free to use the mixer.
    expect(hasAudioCrossfadeEdge(sound, [sound, video({})])).toBe(false);
    expect(hasAudioCrossfadeEdge(sound, [sound, video({ includeAudio: true })])).toBe(true);
    // Between two sound clips the Crossfade always blends sound.
    expect(hasAudioCrossfadeEdge(differentSounds()[0], differentSounds())).toBe(true);
  });
});
