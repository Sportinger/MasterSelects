import { beforeEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({
  routed: new Set<unknown>(),
  applyEffects: vi.fn(async () => true),
  syncCutFades: vi.fn(),
}));
vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: {
    hasRoute: (element: unknown) => routing.routed.has(element),
    applyEffects: routing.applyEffects,
    syncCutFades: routing.syncCutFades,
  },
}));

import { planAudioCrossfadeFromClip, type AudioCrossfadePair } from '../../src/services/audio/audioCrossfadePlanning';
import {
  AUDIO_CROSSFADE_PREROLL_SECONDS,
  planAudioCrossfadeEdgeClips,
  planAudioCrossfadePreviewWindow,
} from '../../src/services/audio/audioCrossfadePreviewVoices';
import { getTransitionAudioEnvelopeGain } from '../../src/services/audio/audioCrossfadeGains';
import { getScheduledEdgeGainAt, scheduleAutomaticCutFades } from '../../src/services/audio/automaticCutFadePlayback';
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

function frameContext(clips: TimelineClip[], playheadPosition: number, isPlaying = true): FrameContext {
  return {
    clips,
    playheadPosition,
    audioTracks: [track],
    isPlaying,
    isDraggingPlayhead: false,
    now: 1000,
    mediaFileById: new Map(clips.map((clip) => [clip.mediaFileId, { duration: MEDIA_DURATION }])),
    unmutedAudioTrackIds: new Set(['a1']),
    getInterpolatedEffects: () => [],
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

function createSync(elements: Record<string, HTMLAudioElement>, synced: AudioSyncTarget[] = []) {
  return new AudioTrackCrossfadeTransitionSync({
    getClipAudioElement: (clip) => elements[clip.id] ?? null,
    getAudioProxyElementForClip: () => null,
    getClipSourceMediaFileId: (clip) => clip.mediaFileId,
    isAudioSourceClip: (clip) => clip.source?.type === 'audio',
    pauseAudioTrackProxy: vi.fn(),
    stopStemBufferMixer: vi.fn(),
    pauseStemAudioElements: vi.fn(),
    syncPreviewAudioElement: (target) => { synced.push(target); },
  });
}

beforeEach(() => {
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
    expect(outgoing.transitionAudioEnvelope).toMatchObject({ role: 'outgoing', curve: 'equal-power', sourceStart: 5.5, sourceEnd: 6.5 });
    // b's source 1.25 s is its head handle 0.75 s before its in point.
    expect(incoming).toMatchObject({ id: 'b', startTime: window.start, inPoint: 2 - (4 - window.start) });
    expect(incoming.transitionAudioEnvelope).toMatchObject({ role: 'incoming', sourceStart: 1.5, sourceEnd: 2.5 });
    expect(getScheduledEdgeGainAt(incoming, incoming.inPoint)).toBe(0);
    expect(getTransitionAudioEnvelopeGain(incoming.transitionAudioEnvelope!, 2)).toBeCloseTo(Math.SQRT1_2);
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
    expect(voiceClip.transitionAudioEnvelope?.role).toBe('sum');
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
    const [outgoing, incoming] = planAudioCrossfadeEdgeClips(pair);
    expect(outgoing.transitionAudioEnvelope).toMatchObject({ role: 'outgoing', sourceEnd: MEDIA_DURATION });
    expect(MEDIA_DURATION - outgoing.transitionAudioEnvelope!.sourceStart).toBeCloseTo(0.005);
    expect(incoming.transitionAudioEnvelope).toMatchObject({ role: 'incoming', sourceStart: 0 });
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
    const sync = createSync({ a: mediaElement('a'), b: mediaElement('b') });
    expect(sync.planFrame(frameContext(clips, 4.6)).tailClipIds.has('a')).toBe(true);
    expect(sync.planFrame(frameContext(clips, 4.5 + 30)).tailClipIds.size).toBe(0);
    // Without an effect there is nothing to ring.
    expect(sync.planFrame(frameContext(differentSounds(), 4.6)).tailClipIds.size).toBe(0);
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
