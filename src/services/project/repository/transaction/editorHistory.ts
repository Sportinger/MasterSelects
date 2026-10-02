import type { HistoryRestoreResult } from '../../../../stores/historyStore/historyStoreTypes';
import { getEditorRepositorySession } from './editorMutationRuntime';
import { hasOpenEditorGestures } from './editorGestureOwnership';

let undoAvailable = false, redoAvailable = false, availabilityEpoch = 0;
const listeners = new Set<() => void>();
export function subscribeEditorHistoryAvailability(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function getEditorHistoryAvailability(): { canUndo: boolean; canRedo: boolean } { return { canUndo: undoAvailable, canRedo: redoAvailable }; }
export async function refreshEditorHistoryAvailability(): Promise<void> {
  const session = getEditorRepositorySession(), epoch = ++availabilityEpoch;
  const revisionId = session?.coordinator.getStatus().revisionId;
  if (!session || !revisionId) { undoAvailable = redoAvailable = false; for (const listener of listeners) listener(); return; }
  const availability = await session.coordinator.getNavigationAvailability();
  if (epoch !== availabilityEpoch || session !== getEditorRepositorySession() || revisionId !== session.coordinator.getStatus().revisionId) return;
  undoAvailable = availability.canUndo; redoAvailable = availability.canRedo;
  for (const listener of listeners) listener();
}
export async function navigateEditorHistory(operation: 'undo' | 'redo'): Promise<HistoryRestoreResult | null> {
  const session = getEditorRepositorySession(); if (!session || hasOpenEditorGestures()) return null;
  const result = operation === 'undo' ? await session.coordinator.undo() : await session.coordinator.redoRevision();
  await refreshEditorHistoryAvailability();
  return result?.status === 'applied' ? { operation, label: operation === 'undo' ? 'Undo edit' : 'Redo edit' } : null;
}
export async function restoreEditorHistoryRevision(revisionId: string): Promise<HistoryRestoreResult | null> {
  const session = getEditorRepositorySession(); if (!session || hasOpenEditorGestures()) return null;
  const result = await session.coordinator.checkout(revisionId);
  await refreshEditorHistoryAvailability();
  return result.status === 'applied' ? { operation: 'restore-branch', label: 'Restore revision' } : null;
}
