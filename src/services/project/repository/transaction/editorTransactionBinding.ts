import type { TransactionToken } from './ProjectTransactionCoordinator';
import { beginEditorTransaction, cancelEditorTransaction, commitEditorTransaction, getEditorRepositorySession,
  getEditorTransactionToken, ownsEditorTransaction, runEditorTransaction } from './editorMutationRuntime';

/**
 * Explicit transaction binding for work that continues after an await.
 *
 * A repository transaction authorizes only synchronous work (runEditorTransaction). Work that awaits and then
 * writes must carry its transaction explicitly: capture the binding before the first await, then run each later
 * synchronous write phase through `run`. Nothing else joins that transaction: a timer, a background job or a
 * user edit that runs during the await keeps its own transaction.
 */
export interface EditorTransactionBinding {
  /** The captured transaction, or null when the capturing work ran without one. */
  readonly token: TransactionToken | null;
  /** True while the captured transaction is still open. */
  isOpen(): boolean;
  /**
   * Runs a synchronous write phase in the captured transaction. When it has closed meanwhile (or there was none),
   * the phase runs as its own revision with `fallbackSource` (or, without one, as the usual untokened edit).
   */
  run<T>(action: () => T): T;
  /**
   * For late results of work the captured transaction started (media loads, waveforms): they join it while it
   * is open (it may hold the same entities), and afterwards land as their own background revision.
   */
  runLate<T>(action: () => T): T;
}

/** Capture before the first await: the transaction that owns the synchronous work running now. */
export function captureEditorTransactionBinding(label: string, options: { fallbackSource?: string } = {}): EditorTransactionBinding {
  const token = getEditorTransactionToken();
  const session = getEditorRepositorySession();
  const isOpen = () => token !== null && getEditorRepositorySession() === session && ownsEditorTransaction(token);
  return {
    token,
    isOpen,
    run(action) {
      if (token && isOpen()) return runEditorTransaction(token, action);
      return options.fallbackSource ? runOwnEditorTransaction(label, options.fallbackSource, action) : action();
    },
    runLate(action) {
      return token && isOpen() ? runEditorTransaction(token, action) : runOwnEditorTransaction(label, 'background', action);
    },
  };
}

/**
 * Runs late results of background work (proxy completion, analysis results, scene descriptions) as their own
 * revision with source 'background': durable, never an Undo/Redo step, and never part of a user's or an
 * assistant's open transaction, whatever is running when the result arrives.
 */
export function runEditorBackgroundWrite<T>(label: string, action: () => T): T {
  return runOwnEditorTransaction(label, 'background', action);
}

function runOwnEditorTransaction<T>(label: string, source: string, action: () => T): T {
  if (!getEditorRepositorySession()) return action();
  const token = beginEditorTransaction(label, source);
  let value: T;
  try { value = runEditorTransaction(token, action); }
  catch (error) { if (ownsEditorTransaction(token)) cancelEditorTransaction(token); throw error; }
  if (ownsEditorTransaction(token)) {
    try { commitEditorTransaction(token); }
    catch (error) { if (ownsEditorTransaction(token)) cancelEditorTransaction(token); throw error; }
  }
  return value;
}
