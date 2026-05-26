import { describe, expect, it } from 'vitest';
import {
  createAudioEqParamsForPresetKind,
  hasAudioEqCharacterMode,
  processAudioEqCharacterChannels,
} from '../../../src/engine/audio';

function sine(length: number, sampleRate: number, frequencyHz: number, amplitude: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate) * amplitude;
  }
  return output;
}

function peak(values: Float32Array): number {
  let max = 0;
  for (const value of values) {
    max = Math.max(max, Math.abs(value));
  }
  return max;
}

describe('audio eq character modes', () => {
  it('detects non-clean character modes', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    expect(hasAudioEqCharacterMode(params)).toBe(false);
    expect(hasAudioEqCharacterMode({
      ...params,
      audible: {
        ...params.audible,
        characterMode: 'warm' as const,
      },
    })).toBe(true);
  });

  it('keeps clean mode bit-identical and bounds warm saturation output', () => {
    const sampleRate = 48_000;
    const input = sine(sampleRate / 4, sampleRate, 1000, 0.95);
    const clean = createAudioEqParamsForPresetKind('parametric');
    const warm = {
      ...clean,
      audible: {
        ...clean.audible,
        characterMode: 'warm' as const,
      },
    };

    const cleanResult = processAudioEqCharacterChannels([input], clean, { sampleRate }).channels[0];
    const warmResult = processAudioEqCharacterChannels([input], warm, { sampleRate }).channels[0];
    if (!cleanResult || !warmResult) throw new Error('missing character output');

    expect(cleanResult).toEqual(input);
    expect(peak(warmResult)).toBeLessThanOrEqual(1.15);
    expect(warmResult.some((value, index) => Math.abs(value - (input[index] ?? 0)) > 0.005)).toBe(true);
  });
});
