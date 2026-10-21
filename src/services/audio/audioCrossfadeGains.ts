import { createBuffer } from '../../engine/audio/audioBufferFactory';
import type { TransitionParticipantPlan, TransitionPlan } from '../../stores/timeline/editOperations/transitionPlanner';
import { getCrossfadeAudioGains, type CrossfadeAudioCurve } from '../../transitions/crossfade';
import type { TransitionAudioEnvelope } from '../../types/timelineCore';

/** Overlaps shorter than this get a de-click at the edit instead of a crossfade. */
export const MIN_AUDIO_CROSSFADE_SECONDS = 0.01;
/** Length of each side's fade when there is (almost) no extra sound to overlap. */
export const AUDIO_DECLICK_SECONDS = 0.005;

/**
 * Where an audio crossfade fades, in timeline seconds. The fade runs only
 * where both clips really have sound (their visible part or real footage
 * beyond the cut), never over a held frame, which plays no sound. Without
 * enough overlap the sounds cut at the edit with a short de-click on each side.
 */
export interface AudioCrossfadeFade {
  kind: 'crossfade' | 'declick';
  curve: CrossfadeAudioCurve;
  outgoingStart: number;
  outgoingEnd: number;
  incomingStart: number;
  incomingEnd: number;
  /** How long both sounds overlap (0 for a de-click). */
  overlap: number;
}

/** Gain ramp of one clip inside one audio crossfade, in timeline seconds. */
export interface AudioCrossfadeGainEnvelope {
  role: 'outgoing' | 'incoming';
  start: number;
  end: number;
  curve: CrossfadeAudioCurve;
}

function getSoundRange(
  participant: TransitionParticipantPlan,
  includeHandles: boolean,
): { start: number; end: number } | null {
  const ranges = participant.coverage.filter((range) =>
    range.kind === 'visible' || (includeHandles && range.kind === 'real-handle'));
  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map((range) => range.startTime)),
    end: Math.max(...ranges.map((range) => range.endTime)),
  };
}

/**
 * The fade window of an audio crossfade plan. `includeHandles` is false when
 * the clips cannot play their extra footage (retimed or reversed clips in
 * export): they then meet at the edit with a de-click.
 */
export function planAudioCrossfadeFade(
  plan: Pick<TransitionPlan, 'outgoing' | 'incoming' | 'junctionTime'>,
  curve: CrossfadeAudioCurve,
  includeHandles = true,
): AudioCrossfadeFade {
  const outgoing = getSoundRange(plan.outgoing, includeHandles) ?? { start: plan.junctionTime, end: plan.junctionTime };
  const incoming = getSoundRange(plan.incoming, includeHandles) ?? { start: plan.junctionTime, end: plan.junctionTime };
  const start = Math.max(outgoing.start, incoming.start);
  const end = Math.min(outgoing.end, incoming.end);
  if (end - start >= MIN_AUDIO_CROSSFADE_SECONDS) {
    return {
      kind: 'crossfade', curve, overlap: end - start,
      outgoingStart: start, outgoingEnd: end, incomingStart: start, incomingEnd: end,
    };
  }
  return {
    kind: 'declick',
    curve,
    overlap: 0,
    outgoingStart: Math.max(outgoing.start, outgoing.end - AUDIO_DECLICK_SECONDS),
    outgoingEnd: outgoing.end,
    incomingStart: incoming.start,
    incomingEnd: Math.min(incoming.end, incoming.start + AUDIO_DECLICK_SECONDS),
  };
}

function getFadeProgress(start: number, end: number, time: number): number {
  if (time <= start) return 0;
  if (time >= end) return 1;
  return (time - start) / (end - start);
}

/** Gain of one envelope at a timeline time: 1 → 0 for the outgoing clip, 0 → 1 for the incoming one. */
export function getAudioCrossfadeEnvelopeGain(envelope: AudioCrossfadeGainEnvelope, time: number): number {
  const gains = getCrossfadeAudioGains(getFadeProgress(envelope.start, envelope.end, time), envelope.curve);
  return envelope.role === 'outgoing' ? gains.outgoing : gains.incoming;
}

/** Gain of a preview crossfade voice at a source time of its clip ('sum': both sides of one recording). */
export function getTransitionAudioEnvelopeGain(envelope: TransitionAudioEnvelope, sourceTime: number): number {
  const gains = getCrossfadeAudioGains(getFadeProgress(envelope.sourceStart, envelope.sourceEnd, sourceTime), envelope.curve);
  if (envelope.role === 'sum') return gains.outgoing + gains.incoming;
  return envelope.role === 'outgoing' ? gains.outgoing : gains.incoming;
}

export function getAudioCrossfadeEnvelopes(fade: AudioCrossfadeFade): {
  outgoing: AudioCrossfadeGainEnvelope;
  incoming: AudioCrossfadeGainEnvelope;
} {
  return {
    outgoing: { role: 'outgoing', start: fade.outgoingStart, end: fade.outgoingEnd, curve: fade.curve },
    incoming: { role: 'incoming', start: fade.incomingStart, end: fade.incomingEnd, curve: fade.curve },
  };
}

export function getAudioCrossfadeGainsAt(fade: AudioCrossfadeFade, time: number): { outgoing: number; incoming: number } {
  const envelopes = getAudioCrossfadeEnvelopes(fade);
  return {
    outgoing: getAudioCrossfadeEnvelopeGain(envelopes.outgoing, time),
    incoming: getAudioCrossfadeEnvelopeGain(envelopes.incoming, time),
  };
}

/**
 * Applies crossfade envelopes sample by sample to clip audio that starts at
 * `clipStartTime` on the timeline, before the clip and track effects, so an
 * effect tail (reverb, delay) decays from the faded sound. Preview applies the
 * same gains on the route's pre-effect gain (TransitionAudioEnvelope).
 * Returns the input buffer when no envelope changes it.
 */
export function applyAudioCrossfadeEnvelopes(
  buffer: AudioBuffer,
  envelopes: readonly AudioCrossfadeGainEnvelope[] | undefined,
  clipStartTime: number,
): AudioBuffer {
  if (!envelopes?.length || buffer.length === 0) return buffer;
  const rate = buffer.sampleRate;
  const sampleAt = (time: number) => Math.max(0, Math.min(buffer.length, Math.round((time - clipStartTime) * rate)));
  // Outgoing gains are 1 before their fade, incoming gains are 1 after it.
  let first = buffer.length;
  let last = 0;
  for (const envelope of envelopes) {
    if (envelope.role === 'outgoing') {
      first = Math.min(first, sampleAt(envelope.start));
      last = buffer.length;
    } else {
      first = 0;
      last = Math.max(last, sampleAt(envelope.end));
    }
  }
  if (last <= first) return buffer;

  const gains = new Float32Array(last - first);
  for (let index = 0; index < gains.length; index += 1) {
    const time = clipStartTime + (first + index) / rate;
    let gain = 1;
    for (const envelope of envelopes) gain *= getAudioCrossfadeEnvelopeGain(envelope, time);
    gains[index] = gain;
  }
  const output = createBuffer(buffer.numberOfChannels, buffer.length, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);
    target.set(source);
    for (let index = 0; index < gains.length; index += 1) {
      target[first + index] = source[first + index] * gains[index];
    }
  }
  return output;
}
