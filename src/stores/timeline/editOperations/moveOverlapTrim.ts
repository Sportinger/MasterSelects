import type { TimelineClip } from '../../../types';
import type { ResolvedClipMove } from './transactionTypes';
import type { TimelineEditWarning } from './types';

type OverlapTrimAction = 'trim-start' | 'trim-end' | 'delete';

interface OverlapTrimModification {
  id: string;
  action: OverlapTrimAction;
  trimAmount?: number;
}

export interface ResolvedMoveOverlapTrimApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  deletedClipIds: string[];
  warnings: TimelineEditWarning[];
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function createDirectModification(
  clip: TimelineClip,
  movingStartTime: number,
  movingDuration: number,
): OverlapTrimModification | null {
  const movingEndTime = movingStartTime + movingDuration;
  const clipEndTime = getClipEnd(clip);

  if (movingEndTime <= clip.startTime || movingStartTime >= clipEndTime) {
    return null;
  }

  if (movingStartTime <= clip.startTime && movingEndTime >= clipEndTime) {
    return { id: clip.id, action: 'delete' };
  }

  if (movingStartTime <= clip.startTime && movingEndTime < clipEndTime) {
    return {
      id: clip.id,
      action: 'trim-start',
      trimAmount: movingEndTime - clip.startTime,
    };
  }

  return {
    id: clip.id,
    action: 'trim-end',
    trimAmount: clipEndTime - movingStartTime,
  };
}

function addLinkedModification(
  modifications: OverlapTrimModification[],
  clips: readonly TimelineClip[],
  directModification: OverlapTrimModification,
  overlapTrimIds: ReadonlySet<string>,
  overlapDeleteIds: ReadonlySet<string>,
): void {
  const directClip = clips.find(clip => clip.id === directModification.id);
  if (!directClip?.linkedClipId) return;
  if (modifications.some(modification => modification.id === directClip.linkedClipId)) return;

  if (directModification.action === 'delete') {
    if (overlapDeleteIds.has(directClip.linkedClipId)) {
      modifications.push({ ...directModification, id: directClip.linkedClipId });
    }
    return;
  }

  if (overlapTrimIds.has(directClip.linkedClipId)) {
    modifications.push({ ...directModification, id: directClip.linkedClipId });
  }
}

function resolveMoveModifications(
  clips: readonly TimelineClip[],
  move: ResolvedClipMove,
): OverlapTrimModification[] {
  if (move.overlap.mode === 'none') return [];

  const movingClip = clips.find(clip => clip.id === move.clipId);
  if (!movingClip) return [];

  const trimIds = new Set(move.overlap.trimClipIds);
  const deleteIds = new Set(move.overlap.deleteClipIds);
  const modifications: OverlapTrimModification[] = [];

  for (const clipId of move.overlap.overlappedClipIds) {
    const clip = clips.find(candidate => candidate.id === clipId);
    if (!clip) continue;
    const modification = createDirectModification(clip, movingClip.startTime, movingClip.duration);
    if (!modification) continue;
    if (modification.action === 'delete' && !deleteIds.has(clip.id)) continue;
    if (modification.action !== 'delete' && !trimIds.has(clip.id)) continue;

    modifications.push(modification);
    addLinkedModification(modifications, clips, modification, trimIds, deleteIds);
  }

  return modifications;
}

function applyModification(clip: TimelineClip, modification: OverlapTrimModification): TimelineClip {
  if (modification.action === 'trim-start' && modification.trimAmount) {
    return {
      ...clip,
      startTime: clip.startTime + modification.trimAmount,
      inPoint: clip.inPoint + modification.trimAmount,
      duration: clip.duration - modification.trimAmount,
    };
  }

  if (modification.action === 'trim-end' && modification.trimAmount) {
    return {
      ...clip,
      duration: clip.duration - modification.trimAmount,
      outPoint: clip.outPoint - modification.trimAmount,
    };
  }

  return clip;
}

export function applyResolvedMoveOverlapTrims(
  clips: readonly TimelineClip[],
  resolvedMoves: readonly ResolvedClipMove[],
): ResolvedMoveOverlapTrimApplyResult {
  const warnings: TimelineEditWarning[] = [];
  let nextClips = [...clips];
  const changedClipIds = new Set<string>();
  const deletedClipIds = new Set<string>();

  for (const move of resolvedMoves) {
    const movingClip = nextClips.find(clip => clip.id === move.clipId);
    if (!movingClip && move.overlap.mode !== 'none') {
      warnings.push({
        code: 'clip-not-found',
        message: 'Moving clip not found for resolved overlap trim.',
        clipId: move.clipId,
      });
      continue;
    }

    const modifications = resolveMoveModifications(nextClips, move);
    if (modifications.length === 0) continue;

    const deleteIds = new Set(
      modifications
        .filter(modification => modification.action === 'delete')
        .map(modification => modification.id),
    );
    for (const id of deleteIds) {
      deletedClipIds.add(id);
      changedClipIds.add(id);
    }
    for (const modification of modifications) {
      if (modification.action !== 'delete') {
        changedClipIds.add(modification.id);
      }
    }

    nextClips = nextClips
      .filter(clip => !deleteIds.has(clip.id))
      .map(clip => {
        const modification = modifications.find(candidate => candidate.id === clip.id);
        return modification ? applyModification(clip, modification) : clip;
      });
  }

  return {
    clips: nextClips,
    changedClipIds: [...changedClipIds],
    deletedClipIds: [...deletedClipIds],
    warnings,
  };
}
