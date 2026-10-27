// One undo step per colour edit gesture (wheel drag, curve-point drag, slider drag, multi-value reset).
//
// With the project repository active, a store change outside an editor gesture becomes its own
// revision, and the per-event input owner the repository tracks is already cleared when a drag's
// window listeners run. A plain startBatch/endBatch pair therefore did not group a colour drag: every
// pointer move (three channel writes each) became its own undo step, for mouse and touch alike, and
// one Undo only stepped back a fraction of the drag. A colour gesture opens a history batch, runs each
// change inside it and commits (or cancels) it at the end — the same contract as pianoRollDragHistory.

import { cancelHistoryBatch, endBatch, startBatch } from '../../../stores/historyStore';
import { finishEditorGesture, runEditorGesture } from '../../../services/project/repository/transaction/editorGestureOwnership';
import { getEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';

export interface ColorEditGesture {
  /** Runs one store change inside the gesture's history batch. */
  run<T>(action: () => T): T;
  /** Commits everything the gesture changed as one undo step. */
  commit(): void;
  /** Drops the gesture; with the repository this restores everything it changed. */
  cancel(): void;
}

export function beginColorEditGesture(label: string): ColorEditGesture {
  const batch = startBatch(label);
  const repository = getEditorRepositorySession() !== null;
  let open = true;
  const close = (cancel: boolean) => {
    if (!open) return;
    open = false;
    if (!batch.opened) return;
    if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId, cancel);
    if (cancel) cancelHistoryBatch(); else endBatch();
  };
  return {
    run: (action) => (open && batch.opened && repository && batch.batchId !== null ? runEditorGesture(batch.batchId, action) : action()),
    commit: () => close(false),
    cancel: () => close(true),
  };
}

/** Runs several store changes as one undo step. */
export function runColorEditGesture<T>(label: string, action: () => T): T {
  const gesture = beginColorEditGesture(label);
  try {
    const result = gesture.run(action);
    gesture.commit();
    return result;
  } catch (error) {
    gesture.cancel();
    throw error;
  }
}
