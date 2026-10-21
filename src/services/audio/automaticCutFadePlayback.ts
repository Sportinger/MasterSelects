import type { TimelineClip } from '../../types/timeline';
import { getTransitionAudioEnvelopeGain } from './audioCrossfadeGains';
import { isAutomaticCutFade } from './automaticCutDeClick';
import { getAudioEditOperationPreviewVolumeMultiplier } from './clipAudioEditPreview';

/** Points per crossfade ramp: a linear ramp between them stays within 0.05 dB of the curve for a 1 s fade. */
const ENVELOPE_POINTS = 64;

export function automaticCutFadeSignature(clip: TimelineClip): string {
  return JSON.stringify([clip.id, clip.inPoint, clip.outPoint,
    (clip.audioState?.editStack ?? []).filter(isAutomaticCutFade), clip.transitionAudioEnvelope ?? null]);
}

/** True when the clip's sound has edge gains (automatic cut de-clicks or a crossfade ramp) to schedule. */
export function hasScheduledEdgeGains(clip: TimelineClip): boolean {
  return Boolean(clip.transitionAudioEnvelope) || clip.audioState?.editStack?.some(isAutomaticCutFade) === true;
}

/** The edge gain (automatic cut de-clicks × crossfade ramp) at a source time of the clip. */
export function getScheduledEdgeGainAt(clip: TimelineClip, sourceTime: number): number {
  const envelope = clip.transitionAudioEnvelope;
  return (clip.audioState?.editStack ?? []).filter(isAutomaticCutFade).reduce((value, operation) => (
    value * getAudioEditOperationPreviewVolumeMultiplier(operation, sourceTime)
  ), envelope ? getTransitionAudioEnvelopeGain(envelope, sourceTime) : 1);
}

/**
 * Schedule against the audio clock; a display frame may miss an entire short
 * fade. Covers the automatic cut de-clicks and a preview crossfade ramp
 * (TransitionAudioEnvelope), both before the route's effects.
 */
export function scheduleAutomaticCutFades(
  gain: AudioParam,
  clip: TimelineClip,
  sourceStart: number,
  contextStart: number,
  rate = 1,
  fadePlaybackStart = false,
): void {
  gain.cancelScheduledValues(contextStart);
  const operations = (clip.audioState?.editStack ?? []).filter(isAutomaticCutFade);
  const envelope = clip.transitionAudioEnvelope;
  const attack = fadePlaybackStart && operations.length > 0 ? Math.min(0.003 * rate, (clip.outPoint - sourceStart) / 2) : 0;
  const valueAt = (time: number) => (attack > 0 ? Math.min(1, Math.max(0, (time - sourceStart) / attack)) : 1) *
    getScheduledEdgeGainAt(clip, time);
  gain.setValueAtTime(valueAt(sourceStart), contextStart);
  if ((operations.length === 0 && !envelope) || rate <= 0 || !Number.isFinite(rate)) return;

  // Only subdivide the fade ranges, never the full source duration. Include
  // overlapping operations in the product so repeated edits keep their envelope.
  const points = new Set<number>();
  const addRange = (rangeStart: number, rangeEnd: number, count: number) => {
    const start = Math.max(sourceStart, clip.inPoint, rangeStart);
    const end = Math.min(clip.outPoint, rangeEnd);
    if (end <= start) return;
    for (let index = 0; index <= count; index += 1) points.add(start + (end - start) * index / count);
  };
  if (attack > 0) points.add(sourceStart + attack);
  for (const operation of operations) {
    const range = operation.timeRange!;
    addRange(Math.min(range.start, range.end), Math.max(range.start, range.end), 32);
  }
  if (envelope) addRange(envelope.sourceStart, envelope.sourceEnd, ENVELOPE_POINTS);
  for (const time of [...points].toSorted((a, b) => a - b)) {
    if (time <= sourceStart) continue;
    gain.linearRampToValueAtTime(valueAt(time), contextStart + (time - sourceStart) / rate);
  }
  // Hold silence after the out edge, even if the display loop pauses us late.
  if (clip.outPoint > sourceStart && valueAt(clip.outPoint) < 0.001) {
    gain.setValueAtTime(0, contextStart + (clip.outPoint - sourceStart) / rate);
  }
}
