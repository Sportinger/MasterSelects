import type { TimelineClip } from '../../types/timeline';
import type { TransitionAudioEnvelope } from '../../types/timelineCore';
import type { AudioCrossfadeFade } from './audioCrossfadeGains';
import { withoutCrossfadedCutDeClick, type AudioCrossfadePair } from './audioCrossfadePlanning';

/**
 * The incoming sound starts this long before its fade, silent, so its element
 * is already running when the fade begins (a cold start takes 20–400 ms).
 */
export const AUDIO_CROSSFADE_PREROLL_SECONDS = 0.25;

/** One sound preview plays during an audio crossfade. */
export interface AudioCrossfadeVoice {
  /** The timeline clip whose audio element plays this voice. */
  clip: TimelineClip;
  /** `clip` played 1:1 over the voice's range, with its gain ramp (TransitionAudioEnvelope). */
  voiceClip: TimelineClip;
}

/**
 * How preview plays an audio crossfade: from `start` to `end` these voices
 * replace the track's normal playback. Afterwards the incoming clip keeps
 * playing on the element the window used (`continuesOn`), so the hand-back
 * needs no element switch.
 */
export interface AudioCrossfadePreviewWindow {
  pair: AudioCrossfadePair;
  start: number;
  end: number;
  voices: AudioCrossfadeVoice[];
  continuesOn: { clip: TimelineClip; elementClip: TimelineClip };
}

function sourceAt(clip: TimelineClip, time: number): number {
  return clip.inPoint + (time - clip.startTime);
}

function createVoiceClip(
  clip: TimelineClip,
  role: TransitionAudioEnvelope['role'],
  start: number,
  end: number,
  fade: AudioCrossfadeFade,
): TimelineClip {
  return {
    ...clip,
    startTime: start,
    duration: end - start,
    inPoint: sourceAt(clip, start),
    outPoint: sourceAt(clip, end),
    transitionAudioEnvelopes: [{
      role,
      curve: fade.curve,
      sourceStart: sourceAt(clip, fade.outgoingStart),
      sourceEnd: sourceAt(clip, fade.outgoingEnd),
    }],
  };
}

/**
 * Plans the preview voices of a crossfade with overlapping sound (fade kind
 * 'crossfade', clips played 1:1). Two different sounds play on their own
 * elements; the incoming one starts AUDIO_CROSSFADE_PREROLL_SECONDS early at
 * gain 0 where its media allows. One continuous recording (`singleVoice`, the
 * halves of a split clip with the same route) plays once on the outgoing
 * element with both gains added, which is exactly the export's sample sum;
 * two unaligned elements of the same sound would comb-filter instead.
 * `notBefore` is where the previous window on the track ends: one track plays
 * one window at a time, so the pre-roll (and, for crossfades that overlap on a
 * short clip, the whole window) starts no earlier.
 * Returns null for a de-click (see addAudioCrossfadeEdgeClips).
 */
export function planAudioCrossfadePreviewWindow(
  pair: AudioCrossfadePair,
  options: { singleVoice: boolean; preroll?: number; notBefore?: number },
): AudioCrossfadePreviewWindow | null {
  const { fade, outgoingClip, incomingClip } = pair;
  if (fade.kind !== 'crossfade' || !pair.usesHandles) return null;
  const outgoing = withoutCrossfadedCutDeClick(outgoingClip, 'outgoing');
  const incoming = withoutCrossfadedCutDeClick(incomingClip, 'incoming');
  const fadeStart = fade.outgoingStart;
  const fadeEnd = fade.outgoingEnd;
  const notBefore = Math.min(fadeEnd, options.notBefore ?? -Infinity);
  if (options.singleVoice) {
    const start = Math.max(fadeStart, notBefore);
    return {
      pair,
      start,
      end: fadeEnd,
      voices: [{ clip: outgoingClip, voiceClip: createVoiceClip(outgoing, 'sum', start, fadeEnd, fade) }],
      continuesOn: { clip: incomingClip, elementClip: outgoingClip },
    };
  }
  const mediaStart = incoming.startTime - incoming.inPoint;
  const preroll = options.preroll ?? AUDIO_CROSSFADE_PREROLL_SECONDS;
  const start = Math.max(notBefore, Math.min(fadeStart, Math.max(fadeStart - preroll, mediaStart)));
  const outgoingStart = Math.max(start, Math.min(fadeStart, outgoing.startTime));
  return {
    pair,
    start,
    end: fadeEnd,
    voices: [
      { clip: outgoingClip, voiceClip: createVoiceClip(outgoing, 'outgoing', outgoingStart, fadeEnd, fade) },
      { clip: incomingClip, voiceClip: createVoiceClip(incoming, 'incoming', start, fadeEnd, fade) },
    ],
    continuesOn: { clip: incomingClip, elementClip: incomingClip },
  };
}

/**
 * Clips that meet at a crossfaded edit as normal playback plays them, merged
 * into `edgeClips` (by clip id) so a clip with crossfades on both edges keeps
 * both. Every crossfaded edge loses its automatic cut de-click, as in export:
 * outside a crossfade's window the clips play without it. A de-click pair (no
 * extra sound to overlap, or a retimed clip) adds its short fades, in source
 * seconds, scheduled ahead on the audio clock and multiplied with the other
 * edge's ones; retimed clips map the timeline fade through their average
 * speed, reversed or remapped clips keep a plain cut with their own de-click.
 */
export function addAudioCrossfadeEdgeClips(edgeClips: Map<string, TimelineClip>, pair: AudioCrossfadePair): void {
  const { fade } = pair;
  const add = (clip: TimelineClip, role: 'outgoing' | 'incoming') => {
    const envelope = fade.kind === 'declick' ? getDeClickEnvelope(clip, role, fade) : null;
    // A reversed or remapped clip keeps its own cut de-click.
    if (fade.kind === 'declick' && !envelope) return;
    const base = withoutCrossfadedCutDeClick(edgeClips.get(clip.id) ?? clip, role);
    edgeClips.set(clip.id, envelope
      ? { ...base, transitionAudioEnvelopes: [...(base.transitionAudioEnvelopes ?? []), envelope] }
      : base);
  };
  add(pair.outgoingClip, 'outgoing');
  add(pair.incomingClip, 'incoming');
}

function getDeClickEnvelope(clip: TimelineClip, role: 'outgoing' | 'incoming', fade: AudioCrossfadeFade): TransitionAudioEnvelope | null {
  if (clip.reversed || clip.timeRemap || clip.duration <= 0) return null;
  const rate = (clip.outPoint - clip.inPoint) / clip.duration;
  if (!(rate > 0)) return null;
  const length = (role === 'outgoing' ? fade.outgoingEnd - fade.outgoingStart : fade.incomingEnd - fade.incomingStart) * rate;
  return role === 'outgoing'
    ? { role, curve: fade.curve, sourceStart: clip.outPoint - length, sourceEnd: clip.outPoint }
    : { role, curve: fade.curve, sourceStart: clip.inPoint, sourceEnd: clip.inPoint + length };
}
