import { describe, expect, it } from 'vitest';

import { buildCompositionSwitchTracks } from '../../src/components/timeline/utils/timelineCompositionSwitchTracks';
import type { TimelineTrack } from '../../src/types/timeline';

const makeTrack = (id: string, type: TimelineTrack['type'] = 'video'): TimelineTrack => ({
  id,
  name: id,
  type,
  height: 60,
  muted: false,
  visible: true,
  solo: false,
});

describe('buildCompositionSwitchTracks', () => {
  it('renders only live tracks when the target snapshot has additional rows', () => {
    const currentTracks = [makeTrack('video-live')];
    const targetTracks = [
      makeTrack('video-target-1'),
      makeTrack('video-target-2'),
      makeTrack('video-target-3'),
    ];

    expect(buildCompositionSwitchTracks(currentTracks, targetTracks)).toBe(currentTracks);
  });

  it('does not retain departing snapshot rows after the live composition loads', () => {
    const currentTracks = [makeTrack('audio-live', 'audio')];
    const previousSnapshot = [
      makeTrack('video-old-1'),
      makeTrack('video-old-2'),
    ];

    expect(buildCompositionSwitchTracks(currentTracks, previousSnapshot)).toEqual(currentTracks);
  });
});
