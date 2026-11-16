// Pure multicam planning: which angle fills which range of the program. The
// program is the set of clips on the angle tracks; at any moment at most one
// angle track has a piece, the others are empty.

import type { TimelineClip, TimelineTrack } from '../../types';
import type { CompositionMulticam, MulticamAngle, MulticamAngleSource } from '../../types/multicam';

const EPSILON = 1e-6;

export type MulticamSwitchMode = 'cut' | 'segment';

export interface MulticamPiece {
  angleIndex: number;
  source: MulticamAngleSource;
  startTime: number;
  endTime: number;
  /** Source time at `startTime`. */
  inPoint: number;
}

export interface MulticamRange {
  startTime: number;
  endTime: number;
}

function sourceEnd(source: MulticamAngleSource): number {
  return source.startTime + source.duration;
}

function clipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function isAngleSourceClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'video'
    && !clip.isComposition
    && Boolean(clip.source.mediaFileId ?? clip.mediaFileId)
    && (clip.speed ?? 1) === 1
    && !clip.reversed;
}

/** Every video track (top first) with plain video clips becomes an angle. */
export function captureMulticamAngles(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
): { angles: MulticamAngle[]; sourceClipIds: string[] } {
  const sourceClipIds: string[] = [];
  const angles = tracks.filter((track) => track.type === 'video').flatMap((track) => {
    const trackClips = clips
      .filter((clip) => clip.trackId === track.id && isAngleSourceClip(clip))
      .toSorted((a, b) => a.startTime - b.startTime);
    if (trackClips.length === 0) return [];
    sourceClipIds.push(...trackClips.map((clip) => clip.id));
    return [{
      trackId: track.id,
      label: track.name,
      sources: trackClips.map((clip) => ({
        mediaFileId: (clip.source?.mediaFileId ?? clip.mediaFileId)!,
        startTime: clip.startTime,
        inPoint: clip.inPoint,
        duration: clip.duration,
        template: {
          name: clip.name,
          transform: structuredClone(clip.transform),
          effects: structuredClone(clip.effects ?? []),
          ...(clip.masks?.length ? { masks: structuredClone(clip.masks) } : {}),
        },
      })),
    }];
  });
  return { angles, sourceClipIds };
}

function pieceFor(angleIndex: number, source: MulticamAngleSource, startTime: number, endTime: number): MulticamPiece {
  return { angleIndex, source, startTime, endTime, inPoint: source.inPoint + (startTime - source.startTime) };
}

/** Pieces of one angle over [start, end), only where that camera has material. */
export function planAnglePieces(
  angles: readonly MulticamAngle[],
  angleIndex: number,
  range: MulticamRange,
): MulticamPiece[] {
  const angle = angles[angleIndex];
  if (!angle) return [];
  return angle.sources.flatMap((source) => {
    const startTime = Math.max(range.startTime, source.startTime);
    const endTime = Math.min(range.endTime, sourceEnd(source));
    return endTime - startTime > EPSILON ? [pieceFor(angleIndex, source, startTime, endTime)] : [];
  });
}

/** Initial program: at every moment the topmost angle that has material there. */
export function planInitialProgram(angles: readonly MulticamAngle[]): MulticamPiece[] {
  const bounds = [...new Set(angles.flatMap((angle) => angle.sources.flatMap((source) => [source.startTime, sourceEnd(source)])))]
    .toSorted((a, b) => a - b);
  const pieces: MulticamPiece[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const startTime = bounds[i]!;
    const endTime = bounds[i + 1]!;
    if (endTime - startTime <= EPSILON) continue;
    const middle = (startTime + endTime) / 2;
    const angleIndex = angles.findIndex((angle) => angle.sources.some((source) => middle >= source.startTime && middle < sourceEnd(source)));
    if (angleIndex < 0) continue;
    const source = angles[angleIndex]!.sources.find((candidate) => middle >= candidate.startTime && middle < sourceEnd(candidate))!;
    const previous = pieces.at(-1);
    if (previous && previous.angleIndex === angleIndex && previous.source === source && Math.abs(previous.endTime - startTime) <= EPSILON) {
      previous.endTime = endTime;
    } else {
      pieces.push(pieceFor(angleIndex, source, startTime, endTime));
    }
  }
  return pieces;
}

/**
 * The program segment around `time`: bounded by the nearest piece edges on the
 * angle tracks (a gap between pieces is a segment too). Null past the material.
 */
export function findProgramSegment(
  multicam: CompositionMulticam,
  clips: readonly TimelineClip[],
  time: number,
): MulticamRange | null {
  const trackIds = new Set(multicam.angles.map((angle) => angle.trackId));
  const materialEnd = Math.max(0, ...multicam.angles.flatMap((angle) => angle.sources.map(sourceEnd)));
  const cuts = [0, materialEnd];
  for (const clip of clips) {
    if (trackIds.has(clip.trackId)) cuts.push(clip.startTime, clipEnd(clip));
  }
  const sorted = [...new Set(cuts)].toSorted((a, b) => a - b);
  let startTime = 0;
  let endTime: number | null = null;
  for (const cut of sorted) {
    if (cut <= time + EPSILON) startTime = cut;
    else { endTime = cut; break; }
  }
  return endTime !== null && endTime - startTime > EPSILON ? { startTime, endTime } : null;
}

/**
 * Range a key press switches: while playing a cut at `time` up to the next
 * existing cut; paused the whole segment under the playhead.
 */
export function planAngleSwitch(
  multicam: CompositionMulticam,
  clips: readonly TimelineClip[],
  time: number,
  angleIndex: number,
  mode: MulticamSwitchMode,
): { range: MulticamRange; pieces: MulticamPiece[] } | null {
  if (!multicam.angles[angleIndex]) return null;
  const segment = findProgramSegment(multicam, clips, time);
  if (!segment) return null;
  const range = mode === 'cut' ? { startTime: Math.max(segment.startTime, time), endTime: segment.endTime } : segment;
  if (range.endTime - range.startTime <= EPSILON) return null;
  return { range, pieces: planAnglePieces(multicam.angles, angleIndex, range) };
}

/** The angle whose track holds the program piece at `time` (-1 in a gap). */
export function getProgramAngleIndex(multicam: CompositionMulticam, clips: readonly TimelineClip[], time: number): number {
  return multicam.angles.findIndex((angle) => clips.some((clip) => clip.trackId === angle.trackId
    && time >= clip.startTime && time < clipEnd(clip)));
}

/** Whether the range already shows exactly `angleIndex` (a repeated key press is a no-op). */
export function isRangeShowingAngle(
  multicam: CompositionMulticam,
  clips: readonly TimelineClip[],
  range: MulticamRange,
  angleIndex: number,
): boolean {
  const target = multicam.angles[angleIndex];
  if (!target) return false;
  const trackIds = new Set(multicam.angles.map((angle) => angle.trackId));
  const overlapping = clips.filter((clip) => trackIds.has(clip.trackId)
    && clip.startTime < range.endTime - EPSILON && clipEnd(clip) > range.startTime + EPSILON);
  if (overlapping.some((clip) => clip.trackId !== target.trackId)) return false;
  const expected = planAnglePieces(multicam.angles, angleIndex, range);
  const covered = overlapping.reduce((sum, clip) => sum
    + Math.min(clipEnd(clip), range.endTime) - Math.max(clip.startTime, range.startTime), 0);
  const expectedLength = expected.reduce((sum, piece) => sum + piece.endTime - piece.startTime, 0);
  return Math.abs(covered - expectedLength) <= EPSILON * 10;
}

/**
 * The camera sync as the program shows it now. Angle sources remember where each camera sat when
 * multicam was enabled; moving the program afterwards (track select + drag, ripple edits) shifts
 * the pieces but not that memory, so a later switch cut in material from the wrong moment.
 * The piece nearest to `time` tells how far the program moved there; every source shifts by that.
 */
export function withProgramSync(
  multicam: CompositionMulticam,
  clips: readonly TimelineClip[],
  time: number,
): CompositionMulticam {
  // The piece on air at `time` decides (half-open, so a piece ending exactly here does not count);
  // only in a gap the nearest piece does, the one after the gap winning a tie. A lead-in placed
  // before the program comes from another moment, so its shift must not leak into the program.
  let best: { rank: number; shift: number } | null = null;
  multicam.angles.forEach((angle) => {
    for (const clip of clips) {
      if (clip.trackId !== angle.trackId) continue;
      const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
      const source = angle.sources.find((candidate) => candidate.mediaFileId === mediaFileId
        && clip.inPoint >= candidate.inPoint - EPSILON && clip.inPoint <= candidate.inPoint + candidate.duration + EPSILON);
      if (!source) continue;
      const onAir = time >= clip.startTime - EPSILON && time < clipEnd(clip) - EPSILON;
      const rank = onAir ? -1 : time < clip.startTime ? clip.startTime - time : time - clipEnd(clip) + EPSILON;
      const shift = clip.startTime - (source.startTime + (clip.inPoint - source.inPoint));
      if (!best || rank < best.rank) best = { rank, shift };
    }
  });
  const shift = (best as { shift: number } | null)?.shift ?? 0;
  if (Math.abs(shift) <= EPSILON) return multicam;
  return {
    ...multicam,
    angles: multicam.angles.map((angle) => ({
      ...angle,
      sources: angle.sources.map((source) => ({ ...source, startTime: source.startTime + shift })),
    })),
  };
}
