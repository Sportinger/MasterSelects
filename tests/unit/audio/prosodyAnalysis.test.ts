import { describe, expect, it } from 'vitest';
import { analyzeProsody } from '../../../src/services/audio/intelligence/prosody/prosodyAnalysis';

const SAMPLE_RATE = 16_000;
const DURATION_SECONDS = 3;
const TONE_HZ = 200;

function syntheticSpeech(): Float32Array {
  return Float32Array.from({ length: SAMPLE_RATE * DURATION_SECONDS }, (_, index) => {
    const time = index / SAMPLE_RATE;
    if (time >= 2) return 0;
    const amplitude = time >= 0.8 && time < 1.2 ? 0.8 : 0.2;
    return amplitude * Math.sin(2 * Math.PI * TONE_HZ * time);
  });
}

describe('analyzeProsody', () => {
  it('tracks pitch, VAD gating, energy shape, and per-word emphasis', () => {
    const result = analyzeProsody({
      pcm: syntheticSpeech(),
      sampleRate: SAMPLE_RATE,
      hopSeconds: 0.02,
      vadSegments: [{ start: 0, end: 2, confidence: 1 }],
      alignedWords: [
        { wordId: 'flat', alignedStart: 0.2, alignedEnd: 0.6, confidence: 1 },
        { wordId: 'bump', alignedStart: 0.8, alignedEnd: 1.2, confidence: 1 },
      ],
    });

    const speechFrames = Math.floor(2 / result.hopSeconds);
    expect(Array.from(result.voicing.slice(speechFrames + 1)).every((value) => value === 0)).toBe(true);
    expect(Array.from(result.f0Hz.slice(speechFrames + 1)).every((value) => value === 0)).toBe(true);

    const flatEnergy = result.energyRmsDb[Math.round(0.4 / result.hopSeconds)] ?? -90;
    const bumpEnergy = result.energyRmsDb[Math.round(1 / result.hopSeconds)] ?? -90;
    expect(bumpEnergy).toBeGreaterThan(flatEnergy + 8);
    expect(result.summary.medianF0Hz).toBeCloseTo(TONE_HZ, 0);

    const flat = result.wordEmphasis?.find((word) => word.wordId === 'flat');
    const bump = result.wordEmphasis?.find((word) => word.wordId === 'bump');
    expect(flat).toBeDefined();
    expect(bump).toBeDefined();
    expect(bump?.emphasis ?? 0).toBeGreaterThan(flat?.emphasis ?? 1);
    expect(bump?.f0MeanHz).toBeCloseTo(TONE_HZ, 0);
  });
});
