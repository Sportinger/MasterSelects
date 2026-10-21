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
    transitionAudioEnvelope: {
      role,
      curve: fade.curve,
      sourceStart: sourceAt(clip, fade.outgoingStart),
      sourceEnd: sourceAt(clip, fade.outgoingEnd),
    },
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
 * Returns null for a de-click (see planAudioCrossfadeEdgeClips).
 */
export function planAudioCrossfadePreviewWindow(
  pair: AudioCrossfadePair,
  options: { singleVoice: boolean; preroll?: number },
): AudioCrossfadePreviewWindow | null {
  const { fade, outgoingClip, incomingClip } = pair;
  if (fade.kind !== 'crossfade' || !pair.usesHandles) return null;
  const outgoing = withoutCrossfadedCutDeClick(outgoingClip, 'outgoing');
  const incoming = withoutCrossfadedCutDeClick(incomingClip, 'incoming');
  const fadeStart = fade.outgoingStart;
  const fadeEnd = fade.outgoingEnd;
  if (options.singleVoice) {
    return {
      pair,
      start: fadeStart,
      end: fadeEnd,
      voices: [{ clip: outgoingClip, voiceClip: createVoiceClip(outgoing, 'sum', fadeStart, fadeEnd, fade) }],
      continuesOn: { clip: incomingClip, elementClip: outgoingClip },
    };
  }
  const mediaStart = incoming.startTime - incoming.inPoint;
  const start = Math.min(fadeStart, Math.max(fadeStart - (options.preroll ?? AUDIO_CROSSFADE_PREROLL_SECONDS), mediaStart));
  const outgoingStart = Math.min(fadeStart, Math.max(start, outgoing.startTime));
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
 * Clips that meet at the edit with a de-click (no extra sound to overlap, or a
 * retimed clip): normal playback carries the short fades, in source seconds,
 * scheduled ahead on the audio clock. Retimed clips map the timeline fade
 * through their average speed; reversed or remapped clips keep a plain cut.
 */
export function planAudioCrossfadeEdgeClips(pair: AudioCrossfadePair): TimelineClip[] {
  const { fade } = pair;
  if (fade.kind !== 'declick') return [];
  const edge = (clip: TimelineClip, role: 'outgoing' | 'incoming'): TimelineClip | null => {
    if (clip.reversed || clip.timeRemap || clip.duration <= 0) return null;
    const rate = (clip.outPoint - clip.inPoint) / clip.duration;
    if (!(rate > 0)) return null;
    const base = withoutCrossfadedCutDeClick(clip, role);
    const length = (role === 'outgoing' ? fade.outgoingEnd - fade.outgoingStart : fade.incomingEnd - fade.incomingStart) * rate;
    const envelope: TransitionAudioEnvelope = role === 'outgoing'
      ? { role, curve: fade.curve, sourceStart: clip.outPoint - length, sourceEnd: clip.outPoint }
      : { role, curve: fade.curve, sourceStart: clip.inPoint, sourceEnd: clip.inPoint + length };
    return { ...base, transitionAudioEnvelope: envelope };
  };
  return [edge(pair.outgoingClip, 'outgoing'), edge(pair.incomingClip, 'incoming')]
    .filter((clip): clip is TimelineClip => clip !== null);
}
