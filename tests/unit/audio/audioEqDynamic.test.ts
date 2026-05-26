import { describe, expect, it } from 'vitest';
import {
  calculateAudioEqDynamicGainDb,
  createAudioEqParamsForPresetKind,
  createAudioEqDynamicRuntimeState,
  hasAudioEqDynamicBands,
  processAudioEqChannels,
} from '../../../src/engine/audio';
import type { AudioEqBandDynamics } from '../../../src/engine/audio';

function rms(values: Float32Array, start: number, end: number): number {
  let sum = 0;
  const length = Math.max(1, end - start);
  for (let index = start; index < end; index += 1) {
    const value = values[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / length);
}

function sine(length: number, sampleRate: number, frequencyHz: number, amplitude: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate) * amplitude;
  }
  return output;
}

describe('audio eq dynamic processing', () => {
  it('calculates compressor and expander dynamic gain from threshold and ratio', () => {
    const base: AudioEqBandDynamics = {
      enabled: true,
      mode: 'compress',
      thresholdDb: -30,
      rangeDb: 6,
      ratio: 3,
      attackMs: 5,
      releaseMs: 120,
      sidechainMode: 'self',
    };

    expect(calculateAudioEqDynamicGainDb(base, -40)).toBe(0);
    expect(calculateAudioEqDynamicGainDb(base, -21)).toBeCloseTo(-6, 3);
    expect(calculateAudioEqDynamicGainDb({ ...base, mode: 'expand' }, -21)).toBeCloseTo(6, 3);
  });

  it('detects only enabled dynamic gain bands', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    expect(hasAudioEqDynamicBands(params)).toBe(false);

    const withDynamic = {
      ...params,
      audible: {
        ...params.audible,
        bands: params.audible.bands.map(band => ({
          ...band,
          dynamic: {
            enabled: true,
            mode: 'compress' as const,
            thresholdDb: -34,
            rangeDb: 8,
            ratio: 4,
            attackMs: 2,
            releaseMs: 80,
            sidechainMode: 'self' as const,
          },
        })),
      },
    };

    expect(hasAudioEqDynamicBands(withDynamic)).toBe(true);
  });

  it('applies dynamic gain reduction to a hot targeted band', () => {
    const sampleRate = 48_000;
    const input = sine(sampleRate, sampleRate, 1000, 0.9);
    const params = createAudioEqParamsForPresetKind('parametric');
    const dynamicParams = {
      ...params,
      audible: {
        ...params.audible,
        bands: params.audible.bands.map(band => ({
          ...band,
          frequencyHz: 1000,
          gainDb: 8,
          q: 4,
          dynamic: {
            enabled: true,
            mode: 'compress' as const,
            thresholdDb: -36,
            rangeDb: 10,
            ratio: 6,
            attackMs: 1,
            releaseMs: 70,
            sidechainMode: 'self' as const,
          },
        })),
      },
    };

    const result = processAudioEqChannels([input], dynamicParams, {
      sampleRate,
      state: createAudioEqDynamicRuntimeState(),
    });
    const output = result.channels[0];
    if (!output) throw new Error('missing output channel');

    expect(result.telemetry[0]?.maxGainReductionDb).toBeGreaterThan(2);
    expect(rms(output, sampleRate / 2, sampleRate)).toBeLessThan(rms(input, sampleRate / 2, sampleRate) * 1.6);
  });
});
