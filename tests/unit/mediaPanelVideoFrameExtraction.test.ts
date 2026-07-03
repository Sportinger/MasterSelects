import { describe, expect, it } from 'vitest';

import {
  getExtractedVideoFrameFileName,
  getVideoFrameExtractionTime,
} from '../../src/components/panels/media/videoFrameExtraction';

describe('video frame extraction helpers', () => {
  it('uses the first frame time for first-frame extraction', () => {
    expect(getVideoFrameExtractionTime(120, 24, 'first')).toBe(0);
  });

  it('seeks just before the end for last-frame extraction', () => {
    expect(getVideoFrameExtractionTime(10, 25, 'last')).toBeCloseTo(9.98);
  });

  it('falls back to a stable default frame offset when fps is unavailable', () => {
    expect(getVideoFrameExtractionTime(1, undefined, 'last')).toBeCloseTo(1 - (1 / 60));
  });

  it('builds deterministic PNG names from video source names', () => {
    expect(getExtractedVideoFrameFileName('Shot 01.mov', 'last')).toBe('Shot 01 - last frame.png');
    expect(getExtractedVideoFrameFileName('', 'first')).toBe('video - first frame.png');
  });
});
