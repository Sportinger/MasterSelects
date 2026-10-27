// Phone clip edit actions: delete (keeps the gap), delete + close gap, duplicate, and the commits
// of the trim and drag gestures. Each dispatches the editor's existing operations with explicit
// clip ids and lands as ONE undo step; failures come back as { ok: false, message } for a toast.

import { Logger } from '../../../services/logger';
import { getEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { finishEditorGesture, runEditorGesture } from '../../../services/project/repository/transaction/editorGestureOwnership';
import { cancelHistoryBatch, endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineEditResult, TimelineClipMove } from '../../../stores/timeline/editOperations/types';
import type { TimelineClip } from '../../../types/timeline';
import {
  clampTrimExtensionToNextClip, computeTrimTiming, trimOriginalsFromClip, type TrimTimingResult,
} from '../../timeline/utils/clipTrimTiming';
import type { PhoneActionResult } from '../contracts';
import { findNearestFreeStart, planPhoneMainTrackDrop } from './phoneReorderPlan';

const log = Logger.create('PhoneClipEdit');
const EPSILON = 1e-4;
let operationSequence = 0;

const nextId = (kind: string) => `phone-${kind}:${++operationSequence}:${Date.now()}`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Maps an edit result to a phone result: failures carry the first warning, warnings are kept. */
export function phoneResultFromEdit(result: TimelineEditResult, fallback: string): PhoneActionResult {
  if (!result.success) return { ok: false, message: result.warnings[0]?.message ?? fallback };
  const notes = result.warnings.filter((warning) => warning.code !== 'no-op').map((warning) => warning.message);
  if (notes.length > 0) log.info('Edit applied with warnings', { warnings: result.warnings });
  return notes.length > 0 ? { ok: true, message: notes.join(' ') } : { ok: true };
}

/**
 * Runs several synchronous store edits as ONE undo step (history batch / repository gesture).
 * A failed result or a throw rolls the whole batch back.
 */
export function runPhoneEditBatch(label: string, apply: () => PhoneActionResult): PhoneActionResult {
  let batch: ReturnType<typeof startBatch>;
  try { batch = startBatch(label); } catch (error) { return { ok: false, message: `${label} failed: ${errorText(error)}` }; }
  const repository = getEditorRepositorySession() !== null;
  const run = <T,>(action: () => T): T => (repository && batch.batchId !== null ? runEditorGesture(batch.batchId, action) : action());
  const rollback = () => {
    if (!batch.opened) return;
    if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId, true);
    cancelHistoryBatch();
  };
  try {
    const result = run(apply);
    if (!result.ok) { rollback(); return result; }
    if (batch.opened) {
      if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId);
      endBatch();
    }
    return result;
  } catch (error) {
    log.error(`${label} threw`, error);
    rollback();
    return { ok: false, message: `${label} failed: ${errorText(error)}` };
  }
}

function selectedIdsOrFailure(verb: string): { ids: string[] } | { failure: PhoneActionResult } {
  const state = useTimelineStore.getState();
  if (state.isExporting) return { failure: { ok: false, message: `${verb} is unavailable while an export is running.` } };
  const selected = state.selectedClipIds ?? new Set<string>();
  const ids = state.clips.filter((clip) => selected.has(clip.id)).map((clip) => clip.id);
  if (ids.length === 0) return { failure: { ok: false, message: `Select a clip first, then tap ${verb}.` } };
  return { ids };
}

function guarded(label: string, action: () => TimelineEditResult, fallback: string): PhoneActionResult {
  try {
    return phoneResultFromEdit(action(), fallback);
  } catch (error) {
    log.error(`${label} threw`, error);
    return { ok: false, message: `${label} failed: ${errorText(error)}` };
  }
}

/** Deletes the selected clips (and their linked partners); later clips keep their positions. */
export function deleteSelectedClips(): PhoneActionResult {
  const selection = selectedIdsOrFailure('Delete');
  if ('failure' in selection) return selection.failure;
  return guarded('Delete', () => useTimelineStore.getState().deleteClipSelection(selection.ids), 'The clip could not be deleted.');
}

/** Deletes the selected clips and closes the gap they leave (explicit ripple delete). */
export function rippleDeleteSelectedClips(): PhoneActionResult {
  const selection = selectedIdsOrFailure('Delete + close gap');
  if ('failure' in selection) return selection.failure;
  return guarded('Delete + close gap', () => useTimelineStore.getState().rippleDeleteSelection(selection.ids), 'The clip could not be deleted.');
}

/**
 * Duplicates the selected clips (with linked partners) right after the selection, using the
 * editor's own copy/paste machinery. Following clips on the involved tracks shift just enough to
 * make room. The user's clipboard and target-track choice are restored afterwards.
 */
export function duplicateSelectedClips(): PhoneActionResult {
  const selection = selectedIdsOrFailure('Duplicate');
  if ('failure' in selection) return selection.failure;
  const state = useTimelineStore.getState();
  if (state.isPlaying) state.pause();
  const selected = new Set(selection.ids);
  for (const clip of state.clips) if (selected.has(clip.id) && clip.linkedClipId) selected.add(clip.linkedClipId);
  const block = state.clips.filter((clip) => selected.has(clip.id));
  const blockStart = Math.min(...block.map((clip) => clip.startTime));
  const blockEnd = Math.max(...block.map((clip) => clip.startTime + clip.duration));
  const span = blockEnd - blockStart;
  const trackIds = new Set(block.map((clip) => clip.trackId));
  const followers = state.clips.filter((clip) => !selected.has(clip.id) && trackIds.has(clip.trackId) && clip.startTime >= blockEnd - EPSILON);
  const firstFollower = Math.min(Infinity, ...followers.map((clip) => clip.startTime));
  const shift = Number.isFinite(firstFollower) ? Math.max(0, blockEnd + span - firstFollower) : 0;

  return runPhoneEditBatch('Duplicate clip', () => {
    if (shift > EPSILON) {
      const moved = useTimelineStore.getState().applyTimelineEditOperation({
        id: nextId('duplicate-room'),
        type: 'move-clips',
        moves: followers.map((clip) => ({ clipId: clip.id, startTime: clip.startTime + shift })),
        includeLinked: true,
      }, { source: 'ui', historyLabel: 'Duplicate clip' });
      if (!moved.success) return phoneResultFromEdit(moved, 'There is no room after the clip for a copy.');
    }
    const before = useTimelineStore.getState();
    const saved = { clipboardData: before.clipboardData, clipboardKeyframes: before.clipboardKeyframes, targetTrackIdByType: before.targetTrackIdByType };
    const beforeIds = new Set(before.clips.map((clip) => clip.id));
    const pastePosition = before.playheadPosition;
    try {
      useTimelineStore.setState({ targetTrackIdByType: {} });
      before.copyClips();
      useTimelineStore.getState().pasteClips();
    } finally {
      useTimelineStore.setState(saved);
    }
    const created = useTimelineStore.getState().clips.filter((clip) => !beforeIds.has(clip.id));
    if (created.length === 0) return { ok: false, message: 'The clip could not be duplicated here.' };
    // Paste lands at the playhead; move the copies right behind the originals in one operation.
    const delta = blockEnd - Math.max(0, pastePosition);
    if (Math.abs(delta) > EPSILON) {
      const placed = useTimelineStore.getState().applyTimelineEditOperation({
        id: nextId('duplicate-place'),
        type: 'move-clips',
        moves: created.map((clip) => ({ clipId: clip.id, startTime: clip.startTime + delta })),
        includeLinked: false,
      }, { source: 'ui', historyLabel: 'Duplicate clip' });
      if (!placed.success) return phoneResultFromEdit(placed, 'The copy could not be placed after the clip.');
    }
    const primary = created.find((clip) => clip.source?.type !== 'audio') ?? created[0];
    useTimelineStore.getState().selectClip(primary.id);
    return { ok: true };
  });
}

/** Neighbour-clamped trim timing for dragging one edge of `clip` by `deltaTime` seconds. */
export function computePhoneTrimTiming(
  clip: TimelineClip,
  edge: 'start' | 'end',
  deltaTime: number,
  clips: readonly TimelineClip[],
): TrimTimingResult {
  let delta = Number.isFinite(deltaTime) ? deltaTime : 0;
  if (edge === 'end') {
    delta = clampTrimExtensionToNextClip(clip, clips, delta);
  } else if (delta < 0) {
    let previousEnd = 0;
    for (const other of clips) {
      const end = other.startTime + other.duration;
      if (other.id !== clip.id && other.trackId === clip.trackId && end <= clip.startTime + EPSILON) previousEnd = Math.max(previousEnd, end);
    }
    delta = Math.max(delta, previousEnd - clip.startTime);
  }
  return computeTrimTiming(clip, edge === 'start' ? 'left' : 'right', trimOriginalsFromClip(clip), delta);
}

/** Commits a trim gesture as ONE trim-clip operation. */
export function commitPhoneClipTrim(clipId: string, timing: TrimTimingResult): PhoneActionResult {
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return { ok: false, message: 'The clip no longer exists.' };
  const remapped = clip.timeRemap?.kind === 'freeze' || clip.timeRemap?.kind === 'loop' || clip.timeRemap?.kind === 'warp';
  return guarded('Trim', () => state.applyTimelineEditOperation({
    id: nextId('trim'),
    type: 'trim-clip',
    clipId,
    inPoint: timing.newInPoint,
    outPoint: timing.newOutPoint,
    ...(remapped ? { duration: timing.newDuration } : {}),
    ...(timing.edge === 'start' ? { startTime: Math.max(0, timing.newStartTime) } : {}),
    includeLinked: true,
  }, { source: 'ui', historyLabel: 'Trim clip' }), 'The clip could not be trimmed.');
}

export interface PhoneClipDrop {
  clipId: string;
  dropStart: number;
  targetTrackId: string;
  /** The emphasized main track: drops there that overlap clips reorder the sequence. */
  mainTrackId: string | null;
}

/** Plans the moves for a dragged clip (reorder, insert or free move) without applying them. */
export function planPhoneClipDrop(drop: PhoneClipDrop, clips: readonly TimelineClip[]): { moves: TimelineClipMove[]; reorder: boolean } | null {
  const clip = clips.find((candidate) => candidate.id === drop.clipId);
  if (!clip) return null;
  if (drop.targetTrackId === drop.mainTrackId) {
    const plan = planPhoneMainTrackDrop({
      trackClips: clips.filter((candidate) => candidate.trackId === drop.targetTrackId),
      draggedClipId: clip.id,
      dropStart: drop.dropStart,
      draggedDuration: clip.duration,
    });
    if (plan.kind === 'reorder') {
      return {
        reorder: true,
        moves: plan.moves.map((move) => (move.clipId === clip.id ? { ...move, trackId: drop.targetTrackId } : move)),
      };
    }
    return { reorder: false, moves: [{ clipId: clip.id, startTime: plan.startTime, trackId: drop.targetTrackId }] };
  }
  const laneClips = clips.filter((candidate) => candidate.trackId === drop.targetTrackId && candidate.id !== clip.id);
  const startTime = findNearestFreeStart(laneClips, clip.duration, drop.dropStart);
  return { reorder: false, moves: [{ clipId: clip.id, startTime, trackId: drop.targetTrackId }] };
}

/** Commits a drag as ONE move-clips operation (linked partners follow). */
export function commitPhoneClipDrop(drop: PhoneClipDrop): PhoneActionResult {
  const state = useTimelineStore.getState();
  if (state.isExporting) return { ok: false, message: 'Moving clips is unavailable while an export is running.' };
  const plan = planPhoneClipDrop(drop, state.clips);
  if (!plan) return { ok: false, message: 'The clip no longer exists.' };
  const clip = state.clips.find((candidate) => candidate.id === drop.clipId);
  const unchanged = plan.moves.length === 1 && clip && clip.trackId === drop.targetTrackId && Math.abs(plan.moves[0].startTime - clip.startTime) <= EPSILON;
  if (unchanged) return { ok: true };
  return guarded('Move', () => state.applyTimelineEditOperation({
    id: nextId(plan.reorder ? 'reorder' : 'move'),
    type: 'move-clips',
    moves: plan.moves,
    includeLinked: true,
  }, { source: 'ui', historyLabel: plan.reorder ? 'Reorder clips' : 'Move clip' }), 'The clip could not be moved there.');
}
