import type { TimelineLoudnessCurve } from '../../../services/audio/timelineLoudnessEnvelopeCache';

export type FlockAudioCurve = Pick<TimelineLoudnessCurve, 'hopDuration' | 'pointCount' | 'values'>;
const preferredMetrics = ['momentary-lufs', 'rms-dbfs', 'short-term-lufs', 'sample-peak-dbfs'];
const fingerprints = new WeakMap<FlockAudioCurve, string>();

export function pickFlockAudioCurve(curves: TimelineLoudnessCurve[]): TimelineLoudnessCurve | null {
  for (const metric of preferredMetrics) {
    const curve = curves.find(candidate => candidate.metric === metric && candidate.channelIndex === undefined)
      ?? curves.find(candidate => candidate.metric === metric);
    if (curve) return curve;
  }
  return curves[0] ?? null;
}

/** Same deterministic dB normalization, clamping and smoothing in both realms. */
export function sampleFlockAudioCurve(curve: FlockAudioCurve | null, audioTime: number, smoothingSeconds: number): number | null {
  if (!curve || curve.pointCount === 0 || curve.hopDuration <= 0) return null;
  const sampleAt = (time: number) => {
    const index = Math.max(0, Math.min(curve.pointCount - 1, Math.floor(time / curve.hopDuration)));
    const value = curve.values[index];
    return Number.isFinite(value) ? Math.max(0, Math.min(1, (value + 60) / 60)) : 0;
  };
  if (smoothingSeconds <= curve.hopDuration) return sampleAt(audioTime);
  const count = Math.min(64, Math.ceil(smoothingSeconds / curve.hopDuration));
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sampleAt(audioTime - i * smoothingSeconds / count);
  return sum / count;
}

/** Cached immutable-analysis content identity, independent of URL or realm. */
export function flockAudioCurveFingerprint(curve: FlockAudioCurve): string {
  const cached = fingerprints.get(curve);
  if (cached) return cached;
  const bits = new Uint32Array(curve.values.buffer, curve.values.byteOffset, curve.values.length);
  let a = 2166136261, b = 0x9e3779b9;
  for (const value of bits) { a = Math.imul(a ^ value, 16777619); b = Math.imul(b ^ value, 2246822507); }
  const result = `${curve.hopDuration}:${curve.pointCount}:${a >>> 0}:${b >>> 0}`;
  fingerprints.set(curve, result);
  return result;
}
