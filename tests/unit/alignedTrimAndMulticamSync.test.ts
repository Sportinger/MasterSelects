import { describe, expect, it } from 'vitest';
import { alignedTrimFollowers } from '../../src/components/timeline/hooks/useClipTrim';
import { withProgramSync, planAngleSwitch } from '../../src/services/multicam/multicamPlan';
import { isTimelineClipCanvasTrimPreviewClip } from '../../src/components/timeline/utils/timelineClipCanvasClipGeometry';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import type { CompositionMulticam } from '../../src/types/multicam';

const clip = (id: string, trackId: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}) =>
  ({ id, trackId, name: id, startTime, duration, inPoint: 100, outPoint: 100 + duration, ...extra }) as TimelineClip;

describe('trimming several selected clips', () => {
  it('moves only the selected edges that line up with the grabbed one', () => {
    const clips = [clip('cam', 'v1', 47, 5), clip('caption', 'v2', 47, 60), clip('stem', 'a1', 47.01, 300), clip('later', 'v1', 52, 10), clip('locked', 'v3', 47, 5)];
    const map = new Map(clips.map(c => [c.id, c]));
    const tracks = [{ id: 'v1' }, { id: 'v2' }, { id: 'a1' }, { id: 'v3', locked: true }] as TimelineTrack[];
    const selected = new Set(clips.map(c => c.id));
    expect(alignedTrimFollowers(clips[0]!, 'left', selected, map, tracks, 25)).toEqual(['caption', 'stem']);
    expect(alignedTrimFollowers(clips[0]!, 'left', new Set(['cam']), map, tracks, 25)).toEqual([]);
    // The followers show the trim live, not only after release.
    const trim = { clipId: 'cam', edge: 'left', followerClipIds: ['caption'] } as never;
    expect(isTimelineClipCanvasTrimPreviewClip({ id: 'caption' }, trim)).toBe(true);
    expect(isTimelineClipCanvasTrimPreviewClip({ id: 'later' }, trim)).toBe(false);
  });
});

describe('multicam switch after the program moved', () => {
  const template = { name: 'cam', transform: {} as never, effects: [] };
  const multicam: CompositionMulticam = {
    version: 1, active: true, groupId: 'g',
    angles: [
      { trackId: 'v1', label: 'Jonas', sources: [{ mediaFileId: 'jonas', startTime: 0, inPoint: 0, duration: 1000, template }] },
      { trackId: 'v2', label: 'holger', sources: [{ mediaFileId: 'holger', startTime: 0, inPoint: 0, duration: 1000, template }] },
    ],
  };
  it('cuts in material from the moment the moved program shows', () => {
    // Everything was moved 30 s to the right: Jonas at timeline 130 plays source 100.
    const program = [clip('p1', 'v1', 130, 20, { mediaFileId: 'jonas', inPoint: 100, outPoint: 120 })];
    const synced = withProgramSync(multicam, program, 140);
    const plan = planAngleSwitch(synced, program, 140, 1, 'segment')!;
    expect(plan.pieces[0]).toMatchObject({ startTime: 130, inPoint: 100 });
    // Without a moved program nothing changes.
    expect(withProgramSync(multicam, [clip('p0', 'v1', 100, 20, { mediaFileId: 'jonas', inPoint: 100, outPoint: 120 })], 110)).toBe(multicam);
  });
});
