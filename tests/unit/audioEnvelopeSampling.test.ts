import { expect, it } from 'vitest';
import { sampleAudioEnvelope, type AudioEnvelopeSampling } from '../../src/services/parameterSources/audioEnvelopeSampling';
import type { TimelineLoudnessEnvelope } from '../../src/services/audio/timelineLoudnessEnvelopeCache';

const envelope: TimelineLoudnessEnvelope = { sampleRate: 100, duration: 1, curves: [
  { metric: 'rms-dbfs', windowDuration: .2, hopDuration: .1, pointCount: 3, values: new Float32Array([-60, -30, 0]) },
] };
const options: AudioEnvelopeSampling = { metric: 'rms-dbfs', sourceTime: .05, interpolation: 'linear', floorDb: -60, ceilingDb: 0 };
it('samples explicit source time with normalized levels and a fixed interpolation policy', () => {
  expect(sampleAudioEnvelope(envelope, options)).toBeCloseTo(.25);
  expect(sampleAudioEnvelope(envelope, { ...options, interpolation: 'nearest' })).toBe(.5);
  expect(sampleAudioEnvelope(envelope, { ...options, sourceTime: .15 })).toBeCloseTo(.75);
  expect(sampleAudioEnvelope(envelope, options)).toBeCloseTo(.25);
});
it('uses silence outside the source and rejects unavailable metrics or corrupt data', () => {
  for (const sourceTime of [-.1, 1, 2]) expect(sampleAudioEnvelope(envelope, { ...options, sourceTime })).toBe(0);
  expect(() => sampleAudioEnvelope(envelope, { ...options, metric: 'momentary-lufs' })).toThrow('no mixed');
  expect(() => sampleAudioEnvelope(envelope, { ...options, ceilingDb: -60 })).toThrow('normalization');
  const invalid = structuredClone(envelope); invalid.curves[0].values[0] = NaN;
  expect(() => sampleAudioEnvelope(invalid, options)).toThrow('invalid level');
});
it('matches the analysis generator rounding of hop duration to sample boundaries', () => {
  const rounded = structuredClone(envelope); rounded.curves[0].hopDuration = .106;
  expect(sampleAudioEnvelope(rounded, { ...options, sourceTime: .11 })).toBe(.5);
});
