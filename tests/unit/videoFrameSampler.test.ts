import { describe, expect, it } from 'vitest';
import {
  isSupportedScanVideo,
  planVideoSampleTimes,
} from '../../src/services/photogrammetry/videoFrameSampler';

describe('photogrammetry video sampling plan', () => {
  it('samples the useful middle 90 percent of a clip evenly', () => {
    expect(planVideoSampleTimes(10, 3)).toEqual([0.5, 5, 9.5]);
    expect(planVideoSampleTimes(8, 1)).toEqual([4]);
    expect(planVideoSampleTimes(10, 3, 2, 6)).toEqual([2.2, 4, 5.8]);
    expect(planVideoSampleTimes(1, 24, 0, 1, 24)).toEqual(
      Array.from({ length: 24 }, (_, frame) => frame / 24),
    );
    expect(planVideoSampleTimes(0, 20)).toEqual([]);
  });

  it('recognizes common browser video sources', () => {
    expect(isSupportedScanVideo(new File(['x'], 'object.MOV'))).toBe(true);
    expect(isSupportedScanVideo(new File(['x'], 'object.mp4', { type: 'video/mp4' }))).toBe(true);
    expect(isSupportedScanVideo(new File(['x'], 'object.txt'))).toBe(false);
  });
});
