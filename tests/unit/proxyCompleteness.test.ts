import { describe, expect, it } from 'vitest';
import type { Sample } from '../../src/engine/webCodecsTypes';
import {
  getExpectedProxyFrameCount,
  isProxyFrameCountComplete,
} from '../../src/stores/mediaStore/helpers/proxyCompleteness';
import {
  getFirstPresentationCts,
  getNormalizedSampleTimestampUs,
} from '../../src/services/proxyGenerator';

function makeSample(cts: number): Sample {
  return {
    number: 0,
    track_id: 1,
    data: new ArrayBuffer(0),
    size: 0,
    cts,
    dts: 0,
    duration: 512,
    is_sync: false,
    timescale: 12288,
  };
}

describe('proxy completeness', () => {
  it('does not add an extra expected frame for tiny duration rounding noise', () => {
    expect(getExpectedProxyFrameCount(5.041666666666667, 24)).toBe(121);
    expect(getExpectedProxyFrameCount(5.041667, 24)).toBe(121);
  });

  it('keeps real fractional frame durations rounded up', () => {
    expect(getExpectedProxyFrameCount(5.05, 24)).toBe(122);
  });

  it('applies the 98 percent threshold to the stable expected frame count', () => {
    expect(isProxyFrameCountComplete(117, 5.041667, 24)).toBe(false);
    expect(isProxyFrameCountComplete(119, 5.041667, 24)).toBe(true);
  });
});

describe('proxy sample timestamps', () => {
  it('normalizes composition-time offsets before deriving frame indices', () => {
    const samples = [makeSample(2048), makeSample(2560), makeSample(61440)];
    const firstPresentationCts = getFirstPresentationCts(samples);

    expect(firstPresentationCts).toBe(2048);
    expect(getNormalizedSampleTimestampUs(samples[0], firstPresentationCts)).toBe(0);
    expect(getNormalizedSampleTimestampUs(samples[1], firstPresentationCts)).toBeCloseTo(41666.67, 1);
    expect(Math.round((getNormalizedSampleTimestampUs(samples[2], firstPresentationCts) / 1_000_000) * 24)).toBe(116);
  });
});
