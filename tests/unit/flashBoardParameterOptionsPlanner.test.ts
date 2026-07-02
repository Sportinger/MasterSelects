import { describe, expect, it } from 'vitest';

import { buildFlashBoardParameterOptions } from '../../src/components/panels/flashboard/FlashBoardParameterOptionsPlanner';

const baseEntry = {
  aspectRatios: ['16:9'],
  durations: [5, 10],
  modes: ['720p', '1080p'],
  outputType: 'video' as const,
};

describe('FlashBoard parameter options planner', () => {
  it('labels Kling modes as resolutions', () => {
    const options = buildFlashBoardParameterOptions({
      activePopover: 'mode',
      aspectRatio: '16:9',
      duration: 5,
      effectiveGenerateAudio: false,
      hasVideoReferenceInput: false,
      imageSize: '1K',
      mode: 'std',
      multiShots: false,
      providerId: 'kling-3.0',
      selectedEntry: {
        ...baseEntry,
        modes: ['std', 'pro', '4K'],
        modeLabels: { std: '720p', pro: '1080p', '4K': '4K' },
      },
      service: 'kieai',
    });

    expect(options.modeOptions.map((option) => option.label)).toEqual(['720p', '1080p', '4K']);
  });

  it('does not offer Runway 1080p for 10 second generations', () => {
    const modeOptions = buildFlashBoardParameterOptions({
      activePopover: 'mode',
      aspectRatio: '16:9',
      duration: 10,
      effectiveGenerateAudio: false,
      hasVideoReferenceInput: false,
      imageSize: '1K',
      mode: '720p',
      multiShots: false,
      providerId: 'runway-video',
      selectedEntry: baseEntry,
      service: 'kieai',
    }).modeOptions;

    const durationOptions = buildFlashBoardParameterOptions({
      activePopover: 'duration',
      aspectRatio: '16:9',
      duration: 5,
      effectiveGenerateAudio: false,
      hasVideoReferenceInput: false,
      imageSize: '1K',
      mode: '1080p',
      multiShots: false,
      providerId: 'runway-video',
      selectedEntry: baseEntry,
      service: 'kieai',
    }).durationOptions;

    expect(modeOptions.map((option) => option.id)).toEqual(['720p']);
    expect(durationOptions.map((option) => option.value)).toEqual([5]);
  });
});
