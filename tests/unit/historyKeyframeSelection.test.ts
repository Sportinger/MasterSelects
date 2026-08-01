import { describe, expect, it } from 'vitest';
import { applyHistorySnapshot } from '../../src/stores/historyStore/snapshotApply';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import type { TimelineStoreState } from '../../src/stores/historyStore/historyStoreTypes';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';

function createTimelineState(selectedKeyframeIds: string[]): TimelineStoreState {
  const track = createMockTrack({ id: 'video-1', type: 'video' });
  const clip = createMockClip({ id: 'clip-1', trackId: track.id, duration: 4 });
  const keyframe = createMockKeyframe({
    id: 'kf-valid',
    clipId: clip.id,
    property: 'position.x',
    time: 1,
    value: 0.25,
  });
  return {
    clips: [clip],
    tracks: [track],
    selectedClipIds: new Set([clip.id]),
    selectedKeyframeIds: new Set(selectedKeyframeIds),
    zoom: 50,
    scrollX: 0,
    layers: [],
    selectedLayerId: null,
    clipKeyframes: new Map([[clip.id, [keyframe]]]),
    markers: [],
  };
}

describe('history keyframe selection', () => {
  it('captures selection with canonical timeline-edit snapshots', () => {
    const timeline = createTimelineState(['kf-valid']);

    const snapshot = createHistorySnapshot('Move motion path', {
      getTimelineState: () => timeline,
    });

    expect(snapshot.timelineEditState).toBeDefined();
    expect(snapshot.timeline.selectedKeyframeIds).toEqual(['kf-valid']);
  });

  it('restores only keyframe ids that exist in the restored snapshot', () => {
    let timeline = createTimelineState(['live-selection']);
    const snapshot = createHistorySnapshot('Move motion path', {
      getTimelineState: () => createTimelineState(['kf-valid']),
    });
    snapshot.timeline.selectedKeyframeIds = ['kf-valid', 'kf-missing'];

    applyHistorySnapshot(snapshot, {
      getTimelineState: () => timeline,
      setTimelineState: (next) => {
        timeline = { ...timeline, ...next };
      },
    });

    expect(timeline.selectedKeyframeIds).toEqual(new Set(['kf-valid']));
  });

  it('preserves live selection when restoring a legacy snapshot without the field', () => {
    let timeline = createTimelineState(['live-selection']);
    const snapshot = createHistorySnapshot('Legacy edit', {
      getTimelineState: () => createTimelineState(['kf-valid']),
    });
    delete snapshot.timeline.selectedKeyframeIds;

    applyHistorySnapshot(snapshot, {
      getTimelineState: () => timeline,
      setTimelineState: (next) => {
        timeline = { ...timeline, ...next };
      },
    });

    expect(timeline.selectedKeyframeIds).toEqual(new Set(['live-selection']));
  });
});
