// One undo step per piano-roll drag (move, resize, group move, eraser swipe).
//
// The drags update the store on every pointer move. With the project repository active, a store
// change outside an editor gesture becomes its own revision, and the input owner the repository
// tracks per event is already cleared when the drag's document listeners run. So every move used
// to become a separate undo step (Undo stepped back through the drag frame by frame) for mouse and
// touch alike. A drag now opens an explicit history batch on its first change, runs each change
// inside it and commits (or cancels) it when the drag ends.

import { cancelHistoryBatch, endBatch, startBatch } from '../../stores/historyStore';
import { finishEditorGesture, runEditorGesture } from '../../services/project/repository/transaction/editorGestureOwnership';
import { getEditorRepositorySession } from '../../services/project/repository/transaction/editorMutationRuntime';

export interface PianoRollDragHistory {
  /** Runs one store change of the drag inside its history batch. */
  run<T>(action: () => T): T;
  /** Commits the drag as one undo step. */
  commit(): void;
  /** Drops the drag; with the repository this restores everything it changed. */
  cancel(): void;
}

export function beginPianoRollDragHistory(label: string): PianoRollDragHistory {
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
    run: (action) => (open && repository && batch.batchId !== null ? runEditorGesture(batch.batchId, action) : action()),
    commit: () => close(false),
    cancel: () => close(true),
  };
}
