import { describe, expect, it } from 'vitest';
import {
  buildTimelineTrackClipShellMountState,
  buildTimelineTrackParentingClipIds,
  buildTimelineTrackShellDomControlClipIds,
} from '../../src/components/timeline/utils/timelineTrackInteractionShellState';
import type { TimelineClip } from '../../src/types/timeline';

function clip(id: string, parentClipId?: string): TimelineClip {
  return {
    id,
    trackId: 'video-track',
    name: id,
    file: null,
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: null,
    effects: [],
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    ...(parentClipId ? { parentClipId } : {}),
  } as TimelineClip;
}

describe('timeline track parenting interaction shells', () => {
  it('does not mount parenting shells for inactive unparented clips', () => {
    const clips = Array.from({ length: 1500 }, (_, index) => clip(`clip-${index}`));
    const parentingClipIds = buildTimelineTrackParentingClipIds({
      trackClips: clips,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      pickWhipDrag: null,
      parentingEnabled: true,
    });
    const domIds = buildTimelineTrackShellDomControlClipIds({
      allTrackClips: clips,
      trackClips: clips,
      clipDrag: null,
      clipTrim: null,
      clipFade: null,
      clipContextMenu: null,
      clipRenameId: null,
      hoveredClipId: null,
      keyframeStateByClipId: new Map(),
      specialStateByClipId: new Map(),
      parentingClipIds,
    });

    expect(parentingClipIds.size).toBe(0);
    expect(domIds.size).toBe(0);
  });

  it('keeps parenting controls for selected, hovered, parented, and active drag clips', () => {
    const clips = [clip('selected'), clip('hovered'), clip('parented', 'parent'), clip('source'), clip('target'), clip('idle')];
    const parentingClipIds = buildTimelineTrackParentingClipIds({
      trackClips: clips,
      selectedClipIds: new Set(['selected']),
      hoveredClipId: 'hovered',
      pickWhipDrag: { sourceClipId: 'source', targetClipId: 'target' },
      parentingEnabled: true,
    });

    expect([...parentingClipIds]).toEqual(['selected', 'hovered', 'parented', 'source', 'target']);
    expect(buildTimelineTrackClipShellMountState({
      clipId: 'selected',
      clipDrag: null,
      clipTrim: null,
      clipFade: null,
      clipContextMenu: null,
      hoveredClipId: null,
      keyframeStateByClipId: new Map(),
      specialStateByClipId: new Map(),
      parentingClipIds,
    })).toMatchObject({ shouldMount: true, reasons: ['parenting'] });
  });
});
