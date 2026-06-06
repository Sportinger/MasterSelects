import { describe, expect, it } from 'vitest';
import type { ClipAudioEditOperation, VideoBakeRegion } from '../../src/types';
import type { TimelineAudioRegionSelection, TimelineVideoBakeRegionSelection } from '../../src/stores/timeline/types';
import {
  resolveAudioEditOperationOverlays,
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
  resolveClipVideoBakeRegionOverlays,
} from '../../src/components/timeline/utils/activeRegionOverlays';

function audioSelection(overrides: Partial<TimelineAudioRegionSelection> = {}): TimelineAudioRegionSelection {
  return {
    clipId: 'clip-1',
    trackId: 'track-1',
    startTime: 12,
    endTime: 18,
    sourceInPoint: 2,
    sourceOutPoint: 8,
    ...overrides,
  };
}

function audioOperation(overrides: Partial<ClipAudioEditOperation>): ClipAudioEditOperation {
  return {
    id: 'op-1',
    type: 'gain',
    enabled: true,
    params: {},
    createdAt: 1,
    ...overrides,
  };
}

describe('active region overlays', () => {
  it('clips audio region selections to the visible clip range', () => {
    expect(resolveAudioRegionOverlay({
      selection: audioSelection({ startTime: 8, endTime: 14 }),
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
    })).toEqual({ left: 0, width: 400 });

    expect(resolveAudioRegionOverlay({
      selection: audioSelection({ startTime: 8, endTime: 9 }),
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
    })).toBeNull();
  });

  it('resolves audio region gain controls from operation params and drag state', () => {
    const control = resolveAudioRegionGainControl({
      selection: audioSelection({ sourceInPoint: 2, sourceOutPoint: 6 }),
      overlayWidth: 400,
      selectedOperation: audioOperation({
        params: { gainDb: 30, fadeInSeconds: 9, fadeOutSeconds: 1 },
      }),
    });

    expect(control).toMatchObject({
      regionDuration: 4,
      gainDb: 24,
      fadeInSeconds: 2,
      fadeOutSeconds: 1,
      fadeInPx: 200,
      fadeOutPx: 100,
    });

    expect(resolveAudioRegionGainControl({
      selection: audioSelection({ sourceInPoint: 2, sourceOutPoint: 6 }),
      overlayWidth: 400,
      selectedOperation: null,
      dragState: {
        currentGainDb: -12,
        currentFadeInSeconds: 0.5,
        currentFadeOutSeconds: 0.25,
      },
    })).toMatchObject({
      gainDb: -12,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 0.25,
    });
  });

  it('creates lane-stacked audio edit operation overlays and hides the selected operation', () => {
    const overlays = resolveAudioEditOperationOverlays({
      operations: [
        audioOperation({ id: 'selected', timeRange: { start: 2, end: 8 } }),
        audioOperation({ id: 'wide', type: 'gain', params: { gainDb: -3 }, timeRange: { start: 1, end: 8 } }),
        audioOperation({ id: 'overlap', type: 'silence', params: {}, timeRange: { start: 3, end: 5 } }),
        audioOperation({ id: 'insert', type: 'insert-silence', params: {}, timeRange: { start: 9, end: 9 } }),
      ],
      audioRegionSelection: audioSelection({ sourceInPoint: 2, sourceOutPoint: 8 }),
      clipId: 'clip-1',
      trackId: 'track-1',
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      trackBaseHeight: 100,
      sourceTimeToDisplayTimelineTime: sourceTime => 10 + sourceTime,
    });

    expect(overlays.map(overlay => overlay.id)).toEqual(['wide', 'overlap', 'insert']);
    expect(overlays[0]).toMatchObject({ left: 100, width: 700, top: 4, height: 16, label: '-3.0 dB' });
    expect(overlays[1]).toMatchObject({ left: 300, width: 200, top: 22, height: 16, label: 'Silence' });
    expect(overlays[2]).toMatchObject({ left: 900, width: 6, top: 4, height: 16, label: 'Insert silence' });
  });

  it('maps clip video bake regions through source range conversion and appends active selection', () => {
    const bakeRegions: VideoBakeRegion[] = [{
      id: 'bake-1',
      scope: 'clip',
      startTime: 0,
      endTime: 0,
      createdAt: 1,
      status: 'baked',
      sourceInPoint: 2,
      sourceOutPoint: 4,
    }];
    const selection: TimelineVideoBakeRegionSelection = {
      scope: 'clip',
      startTime: 15,
      endTime: 16,
    };

    expect(resolveClipVideoBakeRegionOverlays({
      isAudioClip: false,
      bakeRegions,
      selection,
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      sourceTimeToVideoBakeTimelineTime: sourceTime => 10 + sourceTime * 2,
    })).toEqual([
      { id: 'bake-1', status: 'baked', selection: false, left: 400, width: 400 },
      { id: 'clip-video-bake-selection', status: 'marked', selection: true, left: 500, width: 100 },
    ]);

    expect(resolveClipVideoBakeRegionOverlays({
      isAudioClip: true,
      bakeRegions,
      displayStartTime: 10,
      displayDuration: 10,
      width: 1000,
      sourceTimeToVideoBakeTimelineTime: sourceTime => sourceTime,
    })).toEqual([]);
  });
});
