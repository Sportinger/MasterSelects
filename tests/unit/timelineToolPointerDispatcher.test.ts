import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  getTimelineToolCursor,
  resolveTimelineClipPointerTime,
} from '../../src/components/timeline/tools/pointer/timelineToolPointerDispatcher';

const clip = {
  id: 'clip-1',
  trackId: 'video-1',
  startTime: 10,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
} as TimelineClip;

const track = {
  id: 'video-1',
  type: 'video',
  locked: false,
} as TimelineTrack;

const baseContext = {
  toolId: 'blade' as const,
  clip,
  track,
  clips: [
    clip,
    { ...clip, id: 'clip-2', startTime: 20, duration: 4 },
  ] as TimelineClip[],
  playheadPosition: 12,
  snappingEnabled: true,
  displayStartTime: 10,
  displayDuration: 5,
  width: 500,
  clientX: 298,
  rectLeft: 100,
  altKey: false,
};

describe('timeline tool pointer dispatcher', () => {
  it('maps active pointer tools to recognizable cursors', () => {
    expect(getTimelineToolCursor('select')).toBeUndefined();
    expect(getTimelineToolCursor('blade')).toContain('data:image/svg+xml');
    expect(getTimelineToolCursor('blade')).toContain('crosshair');
    expect(getTimelineToolCursor('blade-all-tracks')).toContain('data:image/svg+xml');
    expect(getTimelineToolCursor('track-select-forward')).toContain('e-resize');
    expect(getTimelineToolCursor('track-select-backward')).toContain('w-resize');
    expect(getTimelineToolCursor('track-select-forward-all')).toContain('copy');
    expect(getTimelineToolCursor('range-select')).toContain('crosshair');
    expect(getTimelineToolCursor('edge-trim')).toContain('ew-resize');
    expect(getTimelineToolCursor('ripple-trim')).toContain('ew-resize');
    expect(getTimelineToolCursor('rolling-edit')).toContain('ew-resize');
    expect(getTimelineToolCursor('slip')).toContain('move');
    expect(getTimelineToolCursor('slide')).toContain('move');
    expect(getTimelineToolCursor('rate-stretch')).toContain('ew-resize');
    expect(getTimelineToolCursor('hand')).toContain('grab');
    expect(getTimelineToolCursor('zoom')).toContain('zoom-in');
  });

  it('snaps blade pointer time to playhead or clip edges inside the pixel threshold', () => {
    const result = resolveTimelineClipPointerTime(baseContext);

    expect(result.rawTime).toBeCloseTo(11.98);
    expect(result.time).toBe(12);
    expect(result.snapped).toBe(true);
  });

  it('lets Alt invert snapping for blade pointer time', () => {
    const result = resolveTimelineClipPointerTime({
      ...baseContext,
      altKey: true,
    });

    expect(result.time).toBeCloseTo(11.98);
    expect(result.snapped).toBe(false);
  });

  it('creates a shared preview for blade hover', () => {
    const result = dispatchTimelineClipPointerMove(baseContext);

    expect(result.handled).toBe(true);
    expect(result.preview).toMatchObject({
      toolId: 'blade',
      plane: 'clip-local',
      clipId: 'clip-1',
      trackId: 'video-1',
      time: 12,
    });
  });

  it('uses a section-scrolled preview plane for blade-all-tracks hover', () => {
    const result = dispatchTimelineClipPointerMove({
      ...baseContext,
      toolId: 'blade-all-tracks',
    });

    expect(result.preview).toMatchObject({
      toolId: 'blade-all-tracks',
      plane: 'section-scrolled',
      time: 12,
    });
  });

  it('routes blade click to the split-at-time operation kernel contract', () => {
    const result = dispatchTimelineClipPointerClick(baseContext);

    expect(result.handled).toBe(true);
    expect(result.nextToolId).toBe('select');
    expect(result.operation).toEqual({
      id: 'blade:clip-1:12',
      type: 'split-at-time',
      clipIds: ['clip-1'],
      time: 12,
      includeLinked: true,
    });
  });

  it('routes blade-all-tracks click to a split-all operation', () => {
    const result = dispatchTimelineClipPointerClick({
      ...baseContext,
      toolId: 'blade-all-tracks',
    });

    expect(result.operation).toEqual({
      id: 'blade-all-tracks:12',
      type: 'split-all-at-time',
      time: 12,
      includeLinked: true,
    });
  });

  it('routes track select tools to selection operations', () => {
    const forward = dispatchTimelineClipPointerClick({
      ...baseContext,
      toolId: 'track-select-forward',
      clientX: 250,
    });

    expect(forward.handled).toBe(true);
    expect(forward.operation).toMatchObject({
      type: 'select-clips-from-time',
      time: 11.5,
      direction: 'forward',
      trackIds: ['video-1'],
      includeLinked: true,
    });

    const allTracks = dispatchTimelineClipPointerClick({
      ...baseContext,
      toolId: 'track-select-forward-all',
      clientX: 250,
    });
    expect(allTracks.operation).toMatchObject({
      type: 'select-clips-from-time',
      direction: 'forward',
      trackIds: undefined,
    });
  });

  it('ignores non-pointer tools and blocks locked-track blade previews', () => {
    expect(dispatchTimelineClipPointerMove({
      ...baseContext,
      toolId: 'select',
    }).handled).toBe(false);

    const locked = dispatchTimelineClipPointerMove({
      ...baseContext,
      track: { ...track, locked: true },
    });
    expect(locked.handled).toBe(true);
    expect(locked.preview).toMatchObject({
      blocked: true,
      message: 'Track is locked.',
    });
  });
});
