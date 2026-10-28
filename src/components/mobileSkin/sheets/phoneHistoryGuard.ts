// Global Undo/Redo while an editing sheet holds its own transaction.
//
// An open edit session (phoneEditSession.ts) owns an explicit editor gesture (or a legacy history
// batch). The editor refuses to navigate history while a gesture is open (navigateEditorHistory returns
// null), and the legacy undo would end the sheet's batch under it. So while a session holds changes the
// docked Undo and Redo look disabled and a tap says why, instead of doing nothing.
// Done keeps the sheet's changes as ONE undo step; Cancel reverts exactly them.

import { useSyncExternalStore } from 'react';
import { getEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { hasOpenEditorGestures } from '../../../services/project/repository/transaction/editorGestureOwnership';
import type { PhoneHistoryControls } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

type HistoryOperation = 'undo' | 'redo';

let nextId = 0;
const openSessions = new Map<number, string>();
const listeners = new Set<() => void>();
let snapshot: readonly string[] = [];

function publish(): void {
  snapshot = [...openSessions.values()];
  for (const listener of listeners) listener();
}

/**
 * Marks an edit session as holding changes in its own transaction. Returns the release function;
 * calling it more than once is harmless.
 */
export function registerPhoneEditTransaction(label: string): () => void {
  const id = ++nextId;
  openSessions.set(id, label);
  publish();
  return () => {
    if (openSessions.delete(id)) publish();
  };
}

/** Labels of the edit sessions that currently hold changes, oldest first. */
export function phoneOpenEditTransactions(): readonly string[] {
  return snapshot;
}

/** Why Undo or Redo cannot run right now, or null when it can. */
export function phoneHistoryBlockReason(operation: HistoryOperation): string | null {
  const step = operation === 'undo' ? 'Undo' : 'Redo';
  const label = snapshot[snapshot.length - 1];
  if (label) {
    return `${step} waits for ${label}: tap Done to keep its changes as one undo step, or Cancel to revert them.`;
  }
  // Any other open editor gesture (a slider still held, a running batch) blocks history navigation too.
  if (getEditorRepositorySession() && hasOpenEditorGestures()) {
    return `${step} waits until the current edit is finished.`;
  }
  return null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive block reason for the history buttons (null while Undo/Redo can run). */
export function usePhoneHistoryBlockReason(operation: HistoryOperation): string | null {
  const sessions = useSyncExternalStore(subscribe, phoneOpenEditTransactions, phoneOpenEditTransactions);
  return sessions.length > 0 ? phoneHistoryBlockReason(operation) : null;
}

/**
 * A tap on an Undo or Redo button: runs the step, or explains in a toast why it cannot run now.
 * Never fails silently.
 */
export function runPhoneHistoryTap(operation: HistoryOperation, history: PhoneHistoryControls): void {
  const reason = phoneHistoryBlockReason(operation);
  if (reason) {
    usePhoneUiStore.getState().showToast(reason, 'info');
    return;
  }
  if (operation === 'undo' ? !history.canUndo : !history.canRedo) return;
  if (operation === 'undo') history.undo();
  else history.redo();
}

/** For unit tests. */
export function resetPhoneHistoryGuard(): void {
  openSessions.clear();
  publish();
}
