import { describe, expect, it } from 'vitest';
import { yinPitchFrame } from '../../../src/services/audio/intelligence/prosody/yinPitch';

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 640;

function sine(frequency: number): Float32Array {
  return Float32Array.from(
    { length: FRAME_SAMPLES },
    (_, index) => Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE),
  );
}

describe('yinPitchFrame', () => {
  it.each([220, 110])('tracks a %i Hz sine within 2 Hz', (frequency) => {
    const result = yinPitchFrame(sine(frequency), SAMPLE_RATE);
    expect(Math.abs(result.f0Hz - frequency)).toBeLessThanOrEqual(2);
    expect(result.probability).toBeGreaterThan(0.5);
  });

  it('treats white noise as unvoiced', () => {
    let state = 0x12345678;
    const noise = Float32Array.from({ length: FRAME_SAMPLES }, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x80000000 - 1;
    });
    expect(yinPitchFrame(noise, SAMPLE_RATE)).toEqual({ f0Hz: 0, probability: 0 });
  });

  it.each([150, 200, 300])('tracks a sweep frame at %i Hz', (frequency) => {
    const result = yinPitchFrame(sine(frequency), SAMPLE_RATE);
    expect(Math.abs(result.f0Hz - frequency)).toBeLessThanOrEqual(3);
  });
});
