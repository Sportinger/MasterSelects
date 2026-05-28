import { describe, expect, it } from 'vitest';
import {
  createStemOverlapWindow,
  createStemSegmentStarts,
} from '../../../src/services/audio/stemSeparation/segmentSchedule';

describe('stem segment schedule', () => {
  it('right-aligns the final segment instead of adding a short padded tail segment', () => {
    expect(createStemSegmentStarts(105, 40, 30)).toEqual([0, 30, 60, 65]);
  });

  it('uses a single segment for short sources', () => {
    expect(createStemSegmentStarts(12, 40, 30)).toEqual([0]);
  });

  it('creates non-zero raised-cosine overlap weights at segment edges', () => {
    const window = createStemOverlapWindow(10, 4, 4);

    expect(window[0]).toBeGreaterThan(0);
    expect(window[0]).toBeLessThan(window[3]);
    expect(window[4]).toBe(1);
    expect(window[9]).toBeGreaterThan(0);
    expect(window[9]).toBeLessThan(window[6]);
  });
});
