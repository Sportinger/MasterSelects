import { beforeEach, describe, expect, it } from 'vitest';
import {
  collapseExpandedKeyframeTracksForClipDrag,
  expandClipKeyframeTrackAfterClickRelease,
} from '../../src/components/timeline/utils/clipDragKeyframeDisclosure';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

describe('clip drag keyframe disclosure', () => {
  beforeEach(() => {
    const clip = createMockClip({ id: 'clip-a', trackId: 'video-1' });
    useTimelineStore.setState({
      clips: [clip],
      clipKeyframes: new Map([[clip.id, [createMockKeyframe({ clipId: clip.id })]]]),
      selectedClipIds: new Set(),
      expandedTracks: new Set(['video-1', 'audio-1']),
    });
  });

  it('collapses open keyframe tracks when a real clip drag starts', () => {
    collapseExpandedKeyframeTracksForClipDrag();

    expect([...useTimelineStore.getState().expandedTracks]).toEqual([]);
  });

  it('expands the clicked clip track only after the clip is selected on release', () => {
    useTimelineStore.setState({ expandedTracks: new Set() });

    expandClipKeyframeTrackAfterClickRelease('clip-a');
    expect([...useTimelineStore.getState().expandedTracks]).toEqual([]);

    useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']) });
    expandClipKeyframeTrackAfterClickRelease('clip-a');
    expect([...useTimelineStore.getState().expandedTracks]).toEqual(['video-1']);
  });
});
