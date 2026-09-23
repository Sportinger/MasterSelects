import type { TimelineLoudnessEnvelope } from '../audio/timelineLoudnessEnvelopeCache';

export interface AudioEnvelopeSampling {
  metric: 'rms-dbfs' | 'momentary-lufs' | 'short-term-lufs';
  sourceTime: number;
  interpolation: 'linear' | 'nearest';
  floorDb: number;
  ceilingDb: number;
}

/** Analysis points describe forward windows beginning at n * hop samples.
 * Source time is explicit; this function never observes a playback clock.
 */
export function sampleAudioEnvelope(envelope: TimelineLoudnessEnvelope, options: AudioEnvelopeSampling): number {
  const { sourceTime, floorDb, ceilingDb, metric, interpolation } = options;
  if (![sourceTime, floorDb, ceilingDb, envelope.duration, envelope.sampleRate].every(Number.isFinite)
    || ceilingDb <= floorDb || envelope.duration < 0 || envelope.sampleRate <= 0) {
    throw new Error('Invalid audio envelope time or normalization range.');
  }
  if (interpolation !== 'linear' && interpolation !== 'nearest') throw new Error('Unknown audio envelope interpolation.');
  const curve = envelope.curves.find(curve => curve.metric === metric && curve.channelIndex === undefined);
  if (!curve) throw new Error(`Audio analysis has no mixed ${metric} curve.`);
  if (!Number.isFinite(curve.hopDuration) || curve.hopDuration <= 0 || !Number.isInteger(curve.pointCount)
    || curve.pointCount < 1 || curve.values.length !== curve.pointCount) throw new Error('Malformed audio envelope curve.');
  // Outside the analyzed media is silence, rather than holding the last level.
  if (sourceTime < 0 || sourceTime >= envelope.duration) return 0;
  const hop = Math.max(1, Math.round(curve.hopDuration * envelope.sampleRate)) / envelope.sampleRate;
  const position = Math.min(curve.pointCount - 1, sourceTime / hop);
  const normalized = (index: number) => {
    const db = curve.values[index];
    if (db === -Infinity) return 0;
    if (!Number.isFinite(db)) throw new Error('Audio envelope contains an invalid level.');
    return Math.max(0, Math.min(1, (db - floorDb) / (ceilingDb - floorDb)));
  };
  if (interpolation === 'nearest') return normalized(Math.round(position));
  const left = Math.floor(position), fraction = position - left;
  return normalized(left) * (1 - fraction) + normalized(Math.min(left + 1, curve.pointCount - 1)) * fraction;
}
