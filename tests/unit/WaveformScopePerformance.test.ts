import { describe, expect, it } from 'vitest';

import { getWaveformSampleStride } from '../../src/engine/analysis/WaveformScope';

describe('WaveformScope sampling', () => {
  it('keeps small sources exact and bounds work for HD and UHD sources', () => {
    expect(getWaveformSampleStride(1280, 720)).toBe(1);
    expect(getWaveformSampleStride(1920, 1080)).toBe(2);
    expect(getWaveformSampleStride(3840, 2160)).toBe(3);
    expect(getWaveformSampleStride(7680, 4320)).toBe(4);
  });
});
