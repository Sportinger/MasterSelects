import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import type { CompositionMulticam } from '../../src/types/multicam';
import {
  captureMulticamAngles,
  findProgramSegment,
  getProgramAngleIndex,
  isRangeShowingAngle,
  planAngleSwitch,
  planInitialProgram,
} from '../../src/services/multicam/multicamPlan';

const transform = { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, opacity: 1, anchor: { x: 0, y: 0, z: 0 } };

function track(id: string, type: 'video' | 'audio' = 'video'): TimelineTrack {
  return { id, name: id.toUpperCase(), type, height: 60, muted: false, visible: true, solo: false } as TimelineTrack;
}

function clip(id: string, trackId: string, startTime: number, duration: number, mediaFileId = `media-${id}`, inPoint = 0): TimelineClip {
  return {
    id, trackId, name: id, file: {} as File, startTime, duration, inPoint, outPoint: inPoint + duration,
    source: { type: 'video', mediaFileId, naturalDuration: inPoint + duration },
    transform, effects: [],
  } as unknown as TimelineClip;
}

// Cameras like the show: Jonas (two files), holger, a wide shot from 0 and a total from 56 s.
const tracks = [track('jonas'), track('holger'), track('wide'), track('total'), track('mix', 'audio')];
const originals = [
  clip('jonas1', 'jonas', 100, 400), clip('jonas2', 'jonas', 700, 200),
  clip('holger1', 'holger', 90, 500),
  clip('wide', 'wide', 0, 600),
  clip('total', 'total', 50, 900),
  { ...clip('stem', 'mix', 110, 800), source: { type: 'audio', mediaFileId: 'media-stem', naturalDuration: 800 } } as TimelineClip,
];

function multicamOf(): CompositionMulticam {
  return { version: 1, active: true, groupId: 'g', angles: captureMulticamAngles(tracks, originals).angles };
}

function piecesAsClips(multicam: CompositionMulticam, pieces = planInitialProgram(multicam.angles)): TimelineClip[] {
  return pieces.map((piece, index) => clip(`p${index}`, multicam.angles[piece.angleIndex]!.trackId,
    piece.startTime, piece.endTime - piece.startTime, piece.source.mediaFileId, piece.inPoint));
}

describe('multicam planning', () => {
  it('captures one angle per video track with camera clips, top track first', () => {
    const { angles, sourceClipIds } = captureMulticamAngles(tracks, originals);
    expect(angles.map((angle) => angle.trackId)).toEqual(['jonas', 'holger', 'wide', 'total']);
    expect(angles[0]!.sources.map((source) => source.mediaFileId)).toEqual(['media-jonas1', 'media-jonas2']);
    expect(sourceClipIds).not.toContain('stem');
  });

  it('keeps the topmost camera with material at every moment', () => {
    const program = planInitialProgram(multicamOf().angles)
      .map((piece) => [piece.angleIndex, piece.startTime, piece.endTime]);
    expect(program).toEqual([
      [2, 0, 90], // only the wide shot before holger starts
      [1, 90, 100],
      [0, 100, 500],
      [1, 500, 590],
      [2, 590, 600],
      [3, 600, 700],
      [0, 700, 900],
      [3, 900, 950],
    ]);
  });

  it('maps timeline time to source time in every piece', () => {
    const multicam = multicamOf();
    multicam.angles[0]!.sources[0]!.inPoint = 30;
    const first = planInitialProgram(multicam.angles).find((piece) => piece.angleIndex === 0)!;
    expect(first).toMatchObject({ startTime: 100, inPoint: 30 });
  });

  it('finds the segment between program cuts around the playhead', () => {
    const multicam = multicamOf();
    const clips = piecesAsClips(multicam);
    expect(findProgramSegment(multicam, clips, 250)).toEqual({ startTime: 100, endTime: 500 });
    expect(findProgramSegment(multicam, clips, 500)).toEqual({ startTime: 500, endTime: 590 });
    expect(findProgramSegment(multicam, clips, 2000)).toBeNull();
  });

  it('cuts at the playhead while playing and switches the whole segment while paused', () => {
    const multicam = multicamOf();
    const clips = piecesAsClips(multicam);
    expect(planAngleSwitch(multicam, clips, 250, 3, 'cut')!.range).toEqual({ startTime: 250, endTime: 500 });
    expect(planAngleSwitch(multicam, clips, 250, 3, 'segment')!.range).toEqual({ startTime: 100, endTime: 500 });
  });

  it('fills only where the chosen camera has material', () => {
    const multicam = multicamOf();
    const clips = piecesAsClips(multicam);
    // Segment 500..590 switched to Jonas: Jonas1 ends at 500, Jonas2 starts at 700 -> nothing to fill.
    expect(planAngleSwitch(multicam, clips, 550, 0, 'segment')!.pieces).toEqual([]);
    // Segment 600..700 switched to holger (ends at 590) -> no material either; to the wide shot neither.
    const total = planAngleSwitch(multicam, clips, 650, 3, 'segment')!;
    expect(total.pieces.map((piece) => [piece.startTime, piece.endTime])).toEqual([[600, 700]]);
  });

  it('treats a repeated key for the camera already on air as a no-op', () => {
    const multicam = multicamOf();
    const clips = piecesAsClips(multicam);
    expect(isRangeShowingAngle(multicam, clips, { startTime: 100, endTime: 500 }, 0)).toBe(true);
    expect(isRangeShowingAngle(multicam, clips, { startTime: 100, endTime: 500 }, 1)).toBe(false);
  });

  it('reports the camera on air at the playhead', () => {
    const multicam = multicamOf();
    const clips = piecesAsClips(multicam);
    expect(getProgramAngleIndex(multicam, clips, 250)).toBe(0);
    expect(getProgramAngleIndex(multicam, clips, 620)).toBe(3);
    expect(getProgramAngleIndex(multicam, clips, 5000)).toBe(-1);
  });
});
