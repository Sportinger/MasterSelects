import { describe, expect, it } from 'vitest';
import {
  refineWordTimings,
  type EnergyEnvelope,
} from '../../../src/services/audio/intelligence/alignment/acousticRefineAlignment';
import type { AudioSpan } from '../../../src/services/audio/voiceActivityManifest';

const vad: AudioSpan[] = [{ start: 0, end: 1, confidence: 1 }];

function envelope(valleys: readonly number[]): EnergyEnvelope {
  const values = new Float32Array(101);
  values.fill(1);
  valleys.forEach(time => { values[Math.round(time / 0.01)] = 0; });
  return { values, hopSeconds: 0.01, startSeconds: 0 };
}

describe('refineWordTimings', () => {
  it('snaps a provider boundary to a nearby energy valley', () => {
    const [timing] = refineWordTimings({
      words: [{ id: 'one', text: 'one', start: 0.2, end: 0.56 }],
      wordSource: 'provider',
      vadSegments: vad,
      energy: envelope([0.5, 0.8]),
    });
    expect(timing.alignedStart).toBeCloseTo(0.2);
    expect(timing.alignedEnd).toBeCloseTo(0.5);
    expect(timing.confidence).toBeCloseTo(0.3);
  });

  it('keeps a provider boundary farther than 80 ms from every target', () => {
    const [timing] = refineWordTimings({
      words: [{ id: 'one', text: 'one', start: 0.2, end: 0.4 }],
      wordSource: 'provider',
      vadSegments: [],
      energy: envelope([0.8]),
    });
    expect(timing).toEqual({
      wordId: 'one', alignedStart: 0.2, alignedEnd: 0.4, confidence: 1,
    });
  });

  it('redistributes synthetic words by grapheme weight', () => {
    const timings = refineWordTimings({
      words: [
        { id: 'long', text: 'aaaa', start: 0.1, end: 0.4 },
        { id: 'short', text: 'aa', start: 0.4, end: 0.9 },
      ],
      wordSource: 'synthetic',
      vadSegments: vad,
      energy: envelope([0.2, 0.9]),
    });
    const longDuration = timings[0].alignedEnd - timings[0].alignedStart;
    const shortDuration = timings[1].alignedEnd - timings[1].alignedStart;
    expect(longDuration / shortDuration).toBeCloseTo(2);
  });

  it('enforces monotonic non-overlapping output in input order', () => {
    const timings = refineWordTimings({
      words: [
        { id: 'first', text: 'first', start: 0.3, end: 0.5 },
        { id: 'second', text: 'second', start: 0.4, end: 0.41 },
      ],
      wordSource: 'provider',
      vadSegments: [],
      energy: envelope([]),
    });
    expect(timings[1].alignedStart).toBeGreaterThanOrEqual(timings[0].alignedEnd);
    expect(timings[1].alignedEnd - timings[1].alignedStart).toBeGreaterThanOrEqual(0.02);
  });

  it('keeps synthetic originals at low confidence without VAD segments', () => {
    const words = [
      { id: 'one', text: 'one', start: 0.1, end: 0.3 },
      { id: 'two', text: 'two', start: 0.4, end: 0.7 },
    ];
    const timings = refineWordTimings({
      words,
      wordSource: 'synthetic',
      vadSegments: [],
      energy: envelope([0.2, 0.6]),
    });
    expect(timings).toEqual([
      { wordId: 'one', alignedStart: 0.1, alignedEnd: 0.3, confidence: 0.2 },
      { wordId: 'two', alignedStart: 0.4, alignedEnd: 0.7, confidence: 0.2 },
    ]);
  });
});
