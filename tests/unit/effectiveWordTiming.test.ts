import { describe, expect, it } from 'vitest';
import { effectiveWordTiming } from '../../src/services/transcription/effectiveWordTiming';

const providerTiming = { start: 1, end: 2 };

describe('effectiveWordTiming', () => {
  it('uses valid aligned timings at the default confidence floor', () => {
    expect(effectiveWordTiming({
      ...providerTiming,
      alignedStart: 1.1,
      alignedEnd: 2.1,
      alignmentConfidence: 0.3,
    })).toEqual({ start: 1.1, end: 2.1, aligned: true });
  });

  it.each([
    ['confidence below floor', { alignedStart: 1.1, alignedEnd: 2.1, alignmentConfidence: 0.29 }],
    ['inverted range', { alignedStart: 2.1, alignedEnd: 1.1, alignmentConfidence: 0.9 }],
    ['equal range', { alignedStart: 1.1, alignedEnd: 1.1, alignmentConfidence: 0.9 }],
    ['missing aligned start', { alignedEnd: 2.1, alignmentConfidence: 0.9 }],
    ['missing aligned end', { alignedStart: 1.1, alignmentConfidence: 0.9 }],
    ['missing confidence', { alignedStart: 1.1, alignedEnd: 2.1 }],
    ['non-finite aligned value', { alignedStart: Number.NaN, alignedEnd: 2.1, alignmentConfidence: 0.9 }],
  ])('falls back to provider timing for %s', (_label, alignedFields) => {
    expect(effectiveWordTiming({ ...providerTiming, ...alignedFields }))
      .toEqual({ start: 1, end: 2, aligned: false });
  });

  it('honors a custom minimum confidence and tolerates an invalid option', () => {
    const word = {
      ...providerTiming,
      alignedStart: 1.1,
      alignedEnd: 2.1,
      alignmentConfidence: 0.7,
    };
    expect(effectiveWordTiming(word, { minConfidence: 0.8 }).aligned).toBe(false);
    expect(effectiveWordTiming(word, { minConfidence: Number.NaN }).aligned).toBe(true);
  });
});
