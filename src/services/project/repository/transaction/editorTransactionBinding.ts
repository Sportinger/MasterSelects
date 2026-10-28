import type { TransactionToken } from './ProjectTransactionCoordinator';
import { getEditorRepositorySession, getEditorTransactionToken, ownsEditorTransaction, runEditorOwnRevision,
  runEditorTransaction } from './editorMutationRuntime';
import { Logger } from '../../../logger';

const log = Logger.create('EditorTransactionBinding');

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
   * Throws an AbortError when another project was opened since the capture.
   */
  run<T>(action: () => T): T;
  /**
   * For late results of work the captured transaction started (media loads, waveforms): they join it while it
   * is open (it may hold the same entities), and afterwards land as their own background revision. A late
   * result for a project that is no longer open is dropped.
   */
  runLate<T>(action: () => T): T;
}

/** Capture before the first await: the transaction that owns the synchronous work running now. */
export function captureEditorTransactionBinding(label: string, options: { fallbackSource?: string } = {}): EditorTransactionBinding {
  const token = getEditorTransactionToken();
  const session = getEditorRepositorySession();
  const isOpen = () => token !== null && getEditorRepositorySession() === session && ownsEditorTransaction(token);
  // A later write belongs to the project that was open at capture time, never to one opened during the await.
  const isSameProject = () => getEditorRepositorySession() === session;
  return {
    token,
    isOpen,
    run(action) {
      if (token && isOpen()) return runEditorTransaction(token, action);
      if (!isSameProject()) throw new DOMException(`${label} belongs to a project that is no longer open`, 'AbortError');
      return options.fallbackSource ? runEditorOwnRevision(label, options.fallbackSource, action) : action();
    },
    runLate<T>(action: () => T): T {
      if (token && isOpen()) return runEditorTransaction(token, action);
      if (!isSameProject()) {
        log.debug(`${label}: a late result for a project that is no longer open was dropped`);
        return undefined as T;
      }
      return runEditorOwnRevision(label, 'background', action, { tolerateUnavailable: true });
    },
  };
}

/**
 * Runs late results of background work (proxy completion, analysis results, scene descriptions) as their own
 * revision with source 'background': durable, never an Undo/Redo step, and never part of a user's or an
 * assistant's open transaction, whatever is running when the result arrives. A write of runtime state only
 * (progress, job flags) opens no transaction at all, and a content change while the project cannot take writes
 * (read-only, Undo/Redo activation, handoff) updates the editor without saving instead of throwing into the job.
 */
export function runEditorBackgroundWrite<T>(label: string, action: () => T): T {
  return runEditorOwnRevision(label, 'background', action, { tolerateUnavailable: true });
}
