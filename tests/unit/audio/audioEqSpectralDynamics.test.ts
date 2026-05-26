import { describe, expect, it } from 'vitest';
import {
  calculateAudioEqSpectralDynamicsGainDb,
  chooseAudioEqSpectralDynamicsFftSize,
  createAudioEqParamsForPresetKind,
  getAudioEqSpectralDynamicsBandRange,
  hasAudioEqSpectralDynamicsBands,
  processAudioEqSpectralDynamicsChannels,
} from '../../../src/engine/audio';
import type { AudioEqBandSpectralDynamics } from '../../../src/engine/audio';

function sine(
  length: number,
  sampleRate: number,
  frequencyHz: number,
  amplitude: number,
): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate) * amplitude;
  }
  return output;
}

function addSignals(a: Float32Array, b: Float32Array): Float32Array {
  const output = new Float32Array(Math.min(a.length, b.length));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = (a[index] ?? 0) + (b[index] ?? 0);
  }
  return output;
}

function toneMagnitude(values: Float32Array, sampleRate: number, frequencyHz: number): number {
  let real = 0;
  let imag = 0;
  for (let index = 0; index < values.length; index += 1) {
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    const value = values[index] ?? 0;
    real += value * Math.cos(phase);
    imag -= value * Math.sin(phase);
  }
  return (2 * Math.sqrt(real * real + imag * imag)) / Math.max(1, values.length);
}

describe('audio eq spectral dynamics processing', () => {
  it('calculates compressor and expander spectral gain from threshold and ratio', () => {
    const base: AudioEqBandSpectralDynamics = {
      enabled: true,
      mode: 'compress',
      thresholdDb: -36,
      rangeDb: 9,
      ratio: 4,
      attackMs: 4,
      releaseMs: 90,
      resolution: 'balanced',
    };

    expect(calculateAudioEqSpectralDynamicsGainDb(base, -50)).toBe(0);
    expect(calculateAudioEqSpectralDynamicsGainDb(base, -24)).toBeCloseTo(-9, 3);
    expect(calculateAudioEqSpectralDynamicsGainDb({ ...base, mode: 'expand' }, -24)).toBeCloseTo(9, 3);
  });

  it('detects only enabled spectral dynamics bands and maps resolution to STFT size', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    expect(hasAudioEqSpectralDynamicsBands(params)).toBe(false);
    expect(chooseAudioEqSpectralDynamicsFftSize('low-latency')).toBe(1024);
    expect(chooseAudioEqSpectralDynamicsFftSize('balanced')).toBe(2048);
    expect(chooseAudioEqSpectralDynamicsFftSize('mastering')).toBe(4096);

    const withSpectral = {
      ...params,
      audible: {
        ...params.audible,
        bands: params.audible.bands.map(band => ({
          ...band,
          spectralDynamics: {
            enabled: true,
            mode: 'compress' as const,
            thresholdDb: -34,
            rangeDb: 8,
            ratio: 4,
            attackMs: 2,
            releaseMs: 80,
            resolution: 'balanced' as const,
          },
        })),
      },
    };

    expect(hasAudioEqSpectralDynamicsBands(withSpectral)).toBe(true);
  });

  it('reduces a narrow hot resonance without broad-band attenuation', () => {
    const sampleRate = 48_000;
    const targetFrequency = 984.375;
    const length = sampleRate;
    const input = addSignals(
      sine(length, sampleRate, targetFrequency, 0.82),
      sine(length, sampleRate, 3000, 0.22),
    );
    const params = createAudioEqParamsForPresetKind('parametric');
    const spectralParams = {
      ...params,
      audible: {
        ...params.audible,
        bands: params.audible.bands.map(band => ({
          ...band,
          frequencyHz: targetFrequency,
          gainDb: 0,
          q: 24,
          spectralDynamics: {
            enabled: true,
            mode: 'compress' as const,
            thresholdDb: -42,
            rangeDb: 12,
            ratio: 8,
            attackMs: 0.1,
            releaseMs: 180,
            resolution: 'balanced' as const,
          },
        })),
      },
    };

    const result = processAudioEqSpectralDynamicsChannels([input], spectralParams, { sampleRate });
    const output = result.channels[0];
    if (!output) throw new Error('missing output channel');

    const targetBefore = toneMagnitude(input, sampleRate, targetFrequency);
    const targetAfter = toneMagnitude(output, sampleRate, targetFrequency);
    const neighborBefore = toneMagnitude(input, sampleRate, 3000);
    const neighborAfter = toneMagnitude(output, sampleRate, 3000);

    expect(result.telemetry[0]?.maxGainReductionDb).toBeGreaterThan(6);
    expect(targetAfter).toBeLessThan(targetBefore * 0.45);
    expect(neighborAfter).toBeGreaterThan(neighborBefore * 0.9);
  });

  it('derives narrow bell ranges from q for graph overlays and processing bounds', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    const firstBand = params.audible.bands[0];
    if (!firstBand) throw new Error('missing preset band');
    const band = {
      ...firstBand,
      frequencyHz: 2000,
      q: 20,
    };
    const range = getAudioEqSpectralDynamicsBandRange(band, 48_000);

    expect(range.minHz).toBeGreaterThan(1900);
    expect(range.maxHz).toBeLessThan(2100);
  });
});
