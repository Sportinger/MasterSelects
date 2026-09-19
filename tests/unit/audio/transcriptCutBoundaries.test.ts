import { describe, expect, it } from 'vitest';
import { findTranscriptCutBoundaries } from '../../../src/services/audio/transcriptCutBoundaries';

describe('transcript cut boundaries', () => {
  it('protects word edges without overlapping neighboring words or leaving the source', () => {
    const result = findTranscriptCutBoundaries([
      { start: 0, end: 0.3 }, { start: 0.34, end: 0.8 }, { start: 0.9, end: 1 },
    ], 1);
    expect(result.map(({cutStart, cutEnd}) => [cutStart, cutEnd])).toEqual([
      [0, 0.32], [0.32, 0.85], [0.87, 1],
    ]);
    expect(result.every(item => item.cutBoundarySource === 'padding')).toBe(true);
  });

  it('finds quiet audio outside consonants that extend beyond transcript timestamps', () => {
    const samples = new Float32Array(24000);
    samples.fill(0.2, 9550, 13900);
    const result = findTranscriptCutBoundaries([{ start: 1, end: 1.3 }], 2.4, {
      sampleRate: 10000, length: samples.length, numberOfChannels: 1,
      getChannelData: () => samples,
    });
    expect(result[0].cutStart).toBeLessThanOrEqual(0.952);
    expect(result[0].cutStart).toBeGreaterThanOrEqual(0.92);
    expect(result[0].cutEnd).toBeGreaterThanOrEqual(1.393);
    expect(result[0].cutEnd).toBeLessThanOrEqual(1.42);
    expect(result[0].cutBoundarySource).toBe('waveform');
  });

  it('does not mistake a silent stereo channel or a zero crossing for silence', () => {
    const speech = Float32Array.from({ length: 20000 }, (_, i) => i % 2 ? 0.2 : -0.2);
    const silence = new Float32Array(speech.length);
    const result = findTranscriptCutBoundaries([{ start: 1, end: 1.3 }], 2, {
      sampleRate: 10000, length: speech.length, numberOfChannels: 2,
      getChannelData: channel => channel === 0 ? silence : speech,
    });
    expect(result[0]).toMatchObject({ cutStart: 0.97, cutEnd: 1.35 });
  });
});
