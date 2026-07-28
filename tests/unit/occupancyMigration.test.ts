import { describe, expect, it } from 'vitest';
import { resolveAgentExportRange } from '../../src/services/aiTools/handlers/export';
import { findPlaybackPathAnchor } from '../../src/services/aiTools/handlers/playback/pathPreset';
import type { TimelineStore } from '../../src/services/aiTools/handlers/playback/runtime';
import {
  resolveExportPreviewParityTimelineDuration,
} from '../../src/services/aiTools/handlers/smokes/exportPreviewParity';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const track = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
} satisfies TimelineTrack;

const clips = [
  {
    id: 'clip-1',
    trackId: track.id,
    name: 'Clip 1',
    startTime: 2,
    duration: 3,
  },
] as TimelineClip[];

const timelineWithTrailingPadding = {
  clips,
  tracks: [track],
  duration: 20,
  playheadPosition: 3,
  inPoint: null,
  outPoint: null,
};

describe('timeline occupancy migrations', () => {
  it('uses occupied end instead of trailing store padding across agent surfaces', () => {
    const pathAnchor = findPlaybackPathAnchor(
      timelineWithTrailingPadding as TimelineStore,
    );
    const exportRange = resolveAgentExportRange(timelineWithTrailingPadding, false);
    const smokeDuration = resolveExportPreviewParityTimelineDuration(
      timelineWithTrailingPadding,
    );

    expect(pathAnchor.playableEndTime).toBe(5);
    expect(exportRange).toEqual({ startTime: 0, endTime: 5 });
    expect(smokeDuration).toBe(5);
    expect(exportRange.endTime).toBe(smokeDuration);
  });
});
