import { describe, expect, it } from 'vitest';
import { segmentSpeechProbabilities } from '../../../src/services/audio/intelligence/vad/vadSegmentation';

// 10 ms frames keep the expected times easy to read.
const FRAME_DURATION = 0.01;

const BASE_CONFIG = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechMs: 0,
  minSilenceMs: 0,
  padMs: 0,
};

describe('segmentSpeechProbabilities', () => {
  it('enters at threshold and exits below negThreshold (hysteresis)', () => {
    const probabilities = Float32Array.from([0.1, 0.6, 0.4, 0.4, 0.3, 0.1]);

    const spans = segmentSpeechProbabilities(
      probabilities, FRAME_DURATION, BASE_CONFIG, probabilities.length * FRAME_DURATION,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(0.01, 9);
    expect(spans[0].end).toBeCloseTo(0.04, 9);
  });

  it('does not enter on probabilities between negThreshold and threshold', () => {
    const probabilities = Float32Array.from([0.4, 0.45, 0.49, 0.4]);

    expect(segmentSpeechProbabilities(
      probabilities, FRAME_DURATION, BASE_CONFIG, probabilities.length * FRAME_DURATION,
    )).toEqual([]);
  });

  it('closes an open span at the end of the probability curve', () => {
    const probabilities = Float32Array.from([0.1, 0.8, 0.9]);

    const spans = segmentSpeechProbabilities(
      probabilities, FRAME_DURATION, BASE_CONFIG, probabilities.length * FRAME_DURATION,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(0.01, 9);
    expect(spans[0].end).toBeCloseTo(0.03, 9);
  });

  it('drops spans shorter than minSpeechMs', () => {
    const probabilities = Float32Array.from([
      0.9, 0.9, 0.1, 0.1, // 20 ms blip -> dropped
      0.9, 0.9, 0.9, 0.1, // 30 ms -> kept
    ]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      minSpeechMs: 25,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(0.04, 9);
    expect(spans[0].end).toBeCloseTo(0.07, 9);
  });

  it('merges spans separated by silences shorter than minSilenceMs', () => {
    const probabilities = Float32Array.from([
      0.9, 0.9, // span A
      0.1, 0.1, // 20 ms silence < 25 ms
      0.8, 0.8, // span B
    ]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      minSilenceMs: 25,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(0, 9);
    expect(spans[0].end).toBeCloseTo(0.06, 9);
    // Mean over speech frames only, not the bridged silence.
    expect(spans[0].confidence).toBeCloseTo((0.9 + 0.9 + 0.8 + 0.8) / 4, 5);
  });

  it('keeps spans separated by silences at least minSilenceMs long', () => {
    const probabilities = Float32Array.from([
      0.9, 0.9,
      0.1, 0.1, 0.1, // 30 ms silence >= 25 ms
      0.8, 0.8,
    ]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      minSilenceMs: 25,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(2);
  });

  it('pads spans and clamps to the curve bounds', () => {
    const probabilities = Float32Array.from([0.9, 0.9, 0.9, 0.9, 0.9]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      padMs: 30,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBeCloseTo(0.05, 9);
  });

  it('splits the gap between neighbors when padding would overlap', () => {
    const probabilities = Float32Array.from([
      0.9, 0.9, // raw [0, 0.02]
      0.1, 0.1, 0.1, 0.1, // 40 ms gap, midpoint at 0.04
      0.8, 0.8, // raw [0.06, 0.08]
    ]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      padMs: 30,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toBeCloseTo(0.04, 9);
    expect(spans[1].start).toBeCloseTo(0.04, 9);
    expect(spans[0].end).toBeLessThanOrEqual(spans[1].start);
  });

  it('applies full padding when the gap is at least twice the pad', () => {
    const probabilities = Float32Array.from([
      0.9, 0.9, // raw [0, 0.02]
      0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, // 80 ms gap
      0.8, 0.8, // raw [0.1, 0.12]
    ]);

    const spans = segmentSpeechProbabilities(probabilities, FRAME_DURATION, {
      ...BASE_CONFIG,
      padMs: 30,
    }, probabilities.length * FRAME_DURATION);

    expect(spans).toHaveLength(2);
    expect(spans[0].end).toBeCloseTo(0.05, 9);
    expect(spans[1].start).toBeCloseTo(0.07, 9);
  });

  it('reports the mean probability of speech frames as confidence', () => {
    const probabilities = Float32Array.from([0.1, 0.6, 0.5, 0.4, 0.1]);

    const spans = segmentSpeechProbabilities(
      probabilities, FRAME_DURATION, BASE_CONFIG, probabilities.length * FRAME_DURATION,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0].confidence).toBeCloseTo((0.6 + 0.5 + 0.4) / 3, 5);
  });

  it('shifts spans by offsetSeconds without changing confidence', () => {
    const probabilities = Float32Array.from([0.1, 0.9, 0.9, 0.1]);

    const duration = probabilities.length * FRAME_DURATION;
    const unshifted = segmentSpeechProbabilities(probabilities, FRAME_DURATION, BASE_CONFIG, duration, 0);
    const shifted = segmentSpeechProbabilities(probabilities, FRAME_DURATION, BASE_CONFIG, duration, 5);

    expect(shifted).toHaveLength(1);
    expect(shifted[0].start).toBeCloseTo(unshifted[0].start + 5, 9);
    expect(shifted[0].end).toBeCloseTo(unshifted[0].end + 5, 9);
    expect(shifted[0].confidence).toBeCloseTo(unshifted[0].confidence, 9);
  });

  it('rejects a non-positive frame duration', () => {
    expect(() => segmentSpeechProbabilities(new Float32Array(0), 0, BASE_CONFIG, 0)).toThrow();
  });

  it('clamps a speech-classified final partial frame to the exact PCM duration', () => {
    const probabilities = Float32Array.from([0.1, 0.9]);
    const exactDuration = 0.015;

    const spans = segmentSpeechProbabilities(
      probabilities,
      FRAME_DURATION,
      { ...BASE_CONFIG, padMs: 30 },
      exactDuration,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0].end).toBe(exactDuration);
  });
});
