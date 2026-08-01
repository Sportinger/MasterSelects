import { describe, expect, it } from 'vitest';

import { getVisualPlaybackStateUpdateInterval } from '../../src/components/timeline/hooks/usePlaybackLoop';

describe('getVisualPlaybackStateUpdateInterval', () => {
  it('keeps simple timelines responsive at the normal visual cadence', () => {
    expect(getVisualPlaybackStateUpdateInterval(12, 3)).toBe(33);
  });

  it('includes nested composition clips and tracks in the playback UI budget', () => {
    expect(getVisualPlaybackStateUpdateInterval(17, 5, {
      clipCount: 3,
      visibleTrackCount: 3,
    })).toBe(66);
  });

  it('backs off further for deeply nested timelines', () => {
    expect(getVisualPlaybackStateUpdateInterval(20, 6, {
      clipCount: 150,
      visibleTrackCount: 12,
    })).toBe(125);
  });
});
