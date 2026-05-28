import { describe, expect, it } from 'vitest';
import {
  getClipAudioEditPreviewVolumeMultiplier,
  getRegionGainEnvelopeMultiplier,
} from '../../../src/services/audio/clipAudioEditPreview';
import type { TimelineClip } from '../../../src/types';
import { createMockClip } from '../../helpers/mockData';

function makeAudioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'clip-1',
    trackId: 'track-1',
    source: { type: 'audio' },
    duration: 10,
    outPoint: 10,
    ...overrides,
  });
}

describe('clip audio edit preview', () => {
  it('evaluates gain fades without rendering processed audio', () => {
    const targetGain = 10 ** (-12 / 20);

    expect(getRegionGainEnvelopeMultiplier(0, 0, 10, -12, 2, 2)).toBeCloseTo(1, 4);
    expect(getRegionGainEnvelopeMultiplier(1, 0, 10, -12, 2, 2)).toBeCloseTo(1 + (targetGain - 1) * 0.5, 4);
    expect(getRegionGainEnvelopeMultiplier(5, 0, 10, -12, 2, 2)).toBeCloseTo(targetGain, 4);
    expect(getRegionGainEnvelopeMultiplier(9, 0, 10, -12, 2, 2)).toBeCloseTo(1 + (targetGain - 1) * 0.5, 4);
  });

  it('treats bottom-zone region gain as complete silence', () => {
    expect(getRegionGainEnvelopeMultiplier(5, 0, 10, -120, 0, 0)).toBe(0);
    expect(getRegionGainEnvelopeMultiplier(5, 0, 10, -96, 0, 0)).toBe(0);
    expect(getRegionGainEnvelopeMultiplier(1, 0, 10, -120, 2, 0)).toBeCloseTo(0.5, 4);
  });

  it('uses a live region gain preview instead of double-applying the matching stored operation', () => {
    const clip = makeAudioClip({
      audioState: {
        editStack: [{
          id: 'stored-gain',
          type: 'gain',
          enabled: true,
          params: { gainDb: -3, fadeInSeconds: 0, fadeOutSeconds: 0 },
          timeRange: { start: 2, end: 8 },
          createdAt: 1,
        }],
      },
    });

    const multiplier = getClipAudioEditPreviewVolumeMultiplier(clip, 5, {
      clipId: 'clip-1',
      sourceInPoint: 2,
      sourceOutPoint: 8,
      gainDb: -12,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });

    expect(multiplier).toBeCloseTo(10 ** (-12 / 20), 4);
  });
});
