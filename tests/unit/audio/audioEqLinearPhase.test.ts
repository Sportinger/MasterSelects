import { describe, expect, it } from 'vitest';
import {
  AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES,
  createAudioEqParamsForPresetKind,
  hasAudioEqLinearPhaseMode,
  processAudioEqLinearPhaseChannels,
} from '../../../src/engine/audio';

function impulse(length: number, index: number): Float32Array {
  const output = new Float32Array(length);
  output[index] = 1;
  return output;
}

function peakIndex(values: Float32Array): number {
  let bestIndex = 0;
  let best = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.abs(values[index] ?? 0);
    if (value > best) {
      best = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

describe('audio eq linear phase processing', () => {
  it('detects only static linear-phase eq plans', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    expect(hasAudioEqLinearPhaseMode(params)).toBe(false);
    expect(hasAudioEqLinearPhaseMode({
      ...params,
      audible: {
        ...params.audible,
        phaseMode: 'linear' as const,
      },
    })).toBe(true);
    expect(hasAudioEqLinearPhaseMode({
      ...params,
      audible: {
        ...params.audible,
        phaseMode: 'linear' as const,
        bands: params.audible.bands.map(band => ({
          ...band,
          dynamic: {
            enabled: true,
            mode: 'compress' as const,
            thresholdDb: -30,
            rangeDb: 6,
            ratio: 3,
            attackMs: 4,
            releaseMs: 90,
            sidechainMode: 'self' as const,
          },
        })),
      },
    })).toBe(false);
  });

  it('renders compensated linear-phase FIR output without extending buffer length', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    const linear = {
      ...params,
      audible: {
        ...params.audible,
        phaseMode: 'linear' as const,
        bands: params.audible.bands.map(band => ({
          ...band,
          frequencyHz: 1000,
          gainDb: 6,
          q: 1.2,
        })),
      },
    };

    const input = impulse(8192, 2048);
    const result = processAudioEqLinearPhaseChannels([input], linear, {
      sampleRate: 48_000,
    });
    const output = result.channels[0];
    if (!output) throw new Error('missing linear-phase output');

    expect(result.latencySamples).toBe(AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES);
    expect(output).toHaveLength(input.length);
    expect(Math.abs(peakIndex(output) - 2048)).toBeLessThan(24);
    expect(output.some(value => Number.isNaN(value))).toBe(false);
  });
});
