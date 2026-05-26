import { describe, expect, it } from 'vitest';
import { getAudioPanSliderStyle } from '../../src/components/timeline/utils/audioPanSliderStyle';

describe('getAudioPanSliderStyle', () => {
  it('fills from center toward the current pan side', () => {
    expect(getAudioPanSliderStyle(0)).toMatchObject({
      '--pan-fill-start': '50%',
      '--pan-fill-end': '50%',
    });
    expect(getAudioPanSliderStyle(0.4)).toMatchObject({
      '--pan-fill-start': '50%',
      '--pan-fill-end': '70%',
    });
    expect(getAudioPanSliderStyle(-0.4)).toMatchObject({
      '--pan-fill-start': '30%',
      '--pan-fill-end': '50%',
    });
  });

  it('clamps invalid and out-of-range pan values', () => {
    expect(getAudioPanSliderStyle(Number.NaN)).toMatchObject({
      '--pan-fill-start': '50%',
      '--pan-fill-end': '50%',
    });
    expect(getAudioPanSliderStyle(2)).toMatchObject({
      '--pan-fill-start': '50%',
      '--pan-fill-end': '100%',
    });
    expect(getAudioPanSliderStyle(-2)).toMatchObject({
      '--pan-fill-start': '0%',
      '--pan-fill-end': '50%',
    });
  });
});
