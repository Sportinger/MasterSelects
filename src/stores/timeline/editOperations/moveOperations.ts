import type { TimelineClip, TimelineTrack } from '../../../types';
import type { MoveClipsOperation, TimelineClipMove, TimelineEditWarning } from './types';

export interface MoveClipsApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  warnings: TimelineEditWarning[];
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function isVisualSourceType(sourceType: string | undefined): boolean {
  return sourceType === 'video' ||
    sourceType === 'image' ||
    sourceType === 'lottie' ||
    sourceType === 'rive' ||
    sourceType === 'camera' ||
    sourceType === 'light' ||
    sourceType === 'math-scene' ||
    sourceType === 'model' ||
    sourceType === 'gaussian-avatar' ||
    sourceType === 'gaussian-splat';
}

function isMoveTrackCompatible(clip: TimelineClip, targetTrack: TimelineTrack | undefined): boolean {
  if (!targetTrack) return false;
  const sourceType = clip.source?.type;
  if (isVisualSourceType(sourceType)) return targetTrack.type === 'video';
  if (sourceType === 'audio') return targetTrack.type === 'audio';
  return true;
}

function addLinkedMoves(
  operation: MoveClipsOperation,
  clips: TimelineClip[],
  moveByClipId: Map<string, TimelineClipMove>,
): void {
  if (operation.includeLinked === false) return;

  for (const move of operation.moves) {
    const clip = clips.find((candidate) => candidate.id === move.clipId);
    if (!clip?.linkedClipId || moveByClipId.has(clip.linkedClipId)) continue;

    const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId);
    if (!linkedClip) continue;

    const delta = move.startTime - clip.startTime;
    moveByClipId.set(linkedClip.id, {
      clipId: linkedClip.id,
      startTime: linkedClip.startTime + delta,
      trackId: linkedClip.trackId,
    });
  }
}

export function applyMoveClipsOperation(
  operation: MoveClipsOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): MoveClipsApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const moveByClipId = new Map<string, TimelineClipMove>();

  for (const move of operation.moves) {
    if (!Number.isFinite(move.startTime)) {
      warnings.push({
        code: 'invalid-time',
        message: 'Move start time must be a finite number.',
        clipId: move.clipId,
      });
      continue;
    }
    moveByClipId.set(move.clipId, move);
  }

  addLinkedMoves(operation, clips, moveByClipId);

  const changedClipIds = new Set<string>();
  const validMoves = new Map<string, TimelineClipMove>();

  for (const move of moveByClipId.values()) {
    const clip = clips.find((candidate) => candidate.id === move.clipId);
    if (!clip) {
      warnings.push({ code: 'clip-not-found', message: 'Clip not found for move operation.', clipId: move.clipId });
      continue;
    }

    const targetTrackId = move.trackId ?? clip.trackId;
    const targetTrack = tracks.find((track) => track.id === targetTrackId);
    if (!targetTrack) {
      warnings.push({ code: 'track-locked', message: 'Target track not found for move operation.', clipId: clip.id, trackId: targetTrackId });
      continue;
    }
    if (isTrackLocked(tracks, clip.trackId) || isTrackLocked(tracks, targetTrackId)) {
      warnings.push({ code: 'track-locked', message: 'Cannot move clips from or into locked tracks.', clipId: clip.id, trackId: targetTrackId });
      continue;
    }
    if (!isMoveTrackCompatible(clip, targetTrack)) {
      warnings.push({ code: 'unsupported', message: 'Target track type is incompatible with the clip source.', clipId: clip.id, trackId: targetTrackId });
      continue;
    }

    const nextStartTime = Math.max(0, move.startTime);
    if (Math.abs(nextStartTime - clip.startTime) <= 0.0001 && targetTrackId === clip.trackId) continue;

    validMoves.set(clip.id, {
      clipId: clip.id,
      startTime: nextStartTime,
      trackId: targetTrackId,
    });
    changedClipIds.add(clip.id);
  }

  if (validMoves.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: warnings.length > 0 ? warnings : [{ code: 'no-op', message: 'No clips were moved.' }],
    };
  }

  const nextClips = clips.map((clip) => {
    const move = validMoves.get(clip.id);
    if (!move) return clip;
    return {
      ...clip,
      startTime: move.startTime,
      trackId: move.trackId ?? clip.trackId,
    };
  });

  return {
    clips: nextClips,
    changedClipIds: [...changedClipIds],
    warnings,
  };
}
