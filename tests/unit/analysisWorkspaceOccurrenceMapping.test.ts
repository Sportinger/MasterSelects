import { describe, expect, it } from 'vitest';
import type { Keyframe, TimelineClip } from '../../src/types';
import {
  buildAnalysisWorkspaceTimelineMapping,
  sourceTimeForAnalysisWorkspacePlayhead,
  timelineTimeForAnalysisWorkspaceSource,
} from '../../src/components/panels/properties/analysisWorkspace/analysisWorkspaceOccurrenceMapping';

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-a', startTime: 30, duration: 4, inPoint: 10, outPoint: 20, speed: 2,
    reversed: false, ...overrides,
  } as TimelineClip;
}

const SPEED_KEYFRAME = {
  id: 'speed-1', clipId: 'clip-a', property: 'speed', time: 1, value: 0.5, easing: 'linear',
} as Keyframe;

describe('analysis workspace occurrence mapping', () => {
  it('uses the canonical mapping index for forward and reverse source seeks', () => {
    const forward = buildAnalysisWorkspaceTimelineMapping({
      clip: clip(), sourceId: 'source-a', keyframes: [],
    });
    expect(forward.status).toBe('ready');
    expect(sourceTimeForAnalysisWorkspacePlayhead(forward, 31)).toBe(12);
    expect(timelineTimeForAnalysisWorkspaceSource(forward, 14)).toBe(32);

    const reverse = buildAnalysisWorkspaceTimelineMapping({
      clip: clip({ reversed: true }), sourceId: 'source-a', keyframes: [],
    });
    expect(sourceTimeForAnalysisWorkspacePlayhead(reverse, 31)).toBe(18);
    expect(timelineTimeForAnalysisWorkspaceSource(reverse, 16)).toBe(32);
  });

  it('fails closed for speed-keyframed, transition-remapped, and nested clips', () => {
    expect(buildAnalysisWorkspaceTimelineMapping({
      clip: clip(), sourceId: 'source-a', keyframes: [SPEED_KEYFRAME],
    })).toMatchObject({ status: 'mapping-unavailable' });
    expect(buildAnalysisWorkspaceTimelineMapping({
      clip: clip({ transitionSourceHold: true }), sourceId: 'source-a', keyframes: [],
    })).toMatchObject({ status: 'mapping-unavailable' });
    expect(buildAnalysisWorkspaceTimelineMapping({
      clip: clip({ isComposition: true }), sourceId: 'source-a', keyframes: [],
    })).toMatchObject({ status: 'mapping-unavailable' });
  });
});
