import { getCrossfadeAudioGains } from '../../../transitions/crossfade';

/** Gain ramp of one clip inside one audio crossfade, in timeline (or export-relative) seconds. */
export interface AudioCrossfadeGainEnvelope {
  role: 'outgoing' | 'incoming';
  bodyStart: number;
  bodyEnd: number;
}

/** Crossfade gain of one envelope at a timeline time; 1 outside the body. */
export function getAudioCrossfadeEnvelopeGain(envelope: AudioCrossfadeGainEnvelope, time: number): number {
  if (time < envelope.bodyStart || time > envelope.bodyEnd) return 1;
  const duration = envelope.bodyEnd - envelope.bodyStart;
  const gains = getCrossfadeAudioGains(duration > 1e-6 ? (time - envelope.bodyStart) / duration : 1);
  return envelope.role === 'outgoing' ? gains.outgoing : gains.incoming;
}

/**
 * Samples an envelope for a Web Audio value curve between `from` and `to`
 * (timeline seconds). Linear interpolation between points 5 ms apart stays
 * within 0.1 % of the equal-power curve, even for the shortest crossfade.
 */
export function sampleAudioCrossfadeEnvelope(
  envelope: AudioCrossfadeGainEnvelope,
  from: number,
  to: number,
): Float32Array {
  const duration = Math.max(0, to - from);
  const points = Math.max(2, Math.min(4096, Math.ceil(duration * 200) + 1));
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    curve[index] = getAudioCrossfadeEnvelopeGain(envelope, from + (duration * index) / (points - 1));
  }
  return curve;
}

/**
 * Schedules the crossfade gain curves of one mixer source on its gain param.
 * Envelope times are in the param's context time (export-relative seconds);
 * curves start no earlier than 0 so an export that begins mid-crossfade starts
 * at the right gain, and the base gain returns after each curve.
 */
export function scheduleCrossfadeEnvelopes(
  param: Pick<AudioParam, 'setValueCurveAtTime' | 'setValueAtTime'>,
  envelopes: readonly AudioCrossfadeGainEnvelope[] | undefined,
  baseGain: number,
  contextDuration: number,
): number {
  if (!envelopes?.length) return 0;
  let cursor = 0;
  let scheduled = 0;
  for (const envelope of envelopes.toSorted((a, b) => a.bodyStart - b.bodyStart)) {
    const from = Math.max(cursor, envelope.bodyStart, 0);
    const to = Math.min(envelope.bodyEnd, contextDuration);
    if (!(to - from > 1e-4)) continue;
    const curve = sampleAudioCrossfadeEnvelope(envelope, from, to).map((gain) => gain * baseGain);
    param.setValueCurveAtTime(curve, from, to - from);
    param.setValueAtTime(baseGain, to);
    cursor = to + 1e-4;
    scheduled += 1;
  }
  return scheduled;
}
