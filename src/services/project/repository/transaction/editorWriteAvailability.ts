import { getEditorRepositorySession, subscribeEditorRepositorySession } from './editorMutationRuntime';
import { readEditorContentPublication, subscribeEditorContentPublication } from './editorPublication';

/** Automatic UI actions must wait for an installed writer, just like explicit edits. */
export function isEditorRepositoryWritable(): boolean {
  if (readEditorContentPublication().blocked) return false;
  const session = getEditorRepositorySession();
  if (!session?.opening.writable) return false;
  try { session.coordinator.assertMutable(); return true; } catch { return false; }
}

/** Layout geometry is also usable before scratch recovery and in a read-only project. */
export function canLayoutChangeProjectContent(): boolean {
  return !readEditorContentPublication().blocked
    && (!getEditorRepositorySession() || isEditorRepositoryWritable());
}

export function subscribeEditorWriteAvailability(listener: () => void): () => void {
  let unsubscribeCoordinator = () => {};
  const bind = () => {
    unsubscribeCoordinator();
    unsubscribeCoordinator = getEditorRepositorySession()?.coordinator.subscribe(listener) ?? (() => {});
    listener();
  };
  const unsubscribeSession = subscribeEditorRepositorySession(bind);
  const unsubscribePublication = subscribeEditorContentPublication(listener);
  bind();
  return () => { unsubscribeCoordinator(); unsubscribeSession(); unsubscribePublication(); };
}
