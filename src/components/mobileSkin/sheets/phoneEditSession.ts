// One owned, cancellable transaction per editing sheet (effects, adjust, speed, volume, mask, …).
// Live changes while the sheet is open land in that transaction (a repository gesture, or a legacy
// history batch without a repository): Done commits everything as ONE undo step, Cancel rolls back
// exactly the sheet's own changes, without calling undo (what an assistant request or a background job
// committed while the sheet was open stays).
//
// The session owns its gesture as an explicit owner: an input gesture, a nested startBatch/endBatch
// (e.g. applying a Look) or a window blur (file picker, app switch) cannot end it. Changes should still
// SET absolute values ("brightness = 0.4"): if the gesture is lost anyway (project switch), the next
// change opens a fresh one and the user is told; commit(finalChange) re-applies the final state then.
// A live change that throws is reported to the user (toast), not only logged.

import { useEffect, useRef } from 'react';

import { Logger } from '../../../services/logger';
import {
  captureEditorTransactionAcrossAwaits, getEditorRepositorySession, ownsEditorTransaction, runEditorBatch,
} from '../../../services/project/repository/transaction/editorMutationRuntime';
import type { TransactionToken } from '../../../services/project/repository/transaction/ProjectTransactionCoordinator';
import {
  beginEditorGesture, finishEditorGesture, runEditorGesture,
} from '../../../services/project/repository/transaction/editorGestureOwnership';
import { cancelHistoryBatch, endBatch, startBatch } from '../../../stores/historyStore';
import type { PhoneActionResult } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

const log = Logger.create('PhoneEditSession');

type Change = () => void | Promise<void>;

export interface PhoneEditSession {
  readonly label: string;
  /** Applies a live change inside the session's transaction (opened on first use). Changes run in order. */
  apply: (change: Change) => Promise<void>;
  /** Re-applies finalChange (when given) and commits everything as one undo step. */
  commit: (finalChange?: Change) => Promise<PhoneActionResult>;
  /** Rolls every live change back. A session that never changed anything just closes. */
  cancel: () => void;
  readonly changed: boolean;
  readonly closed: boolean;
}

export interface PhoneEditSessionOptions {
  /** Shown when a live change fails or earlier changes were lost. Default: an error toast. */
  onError?: (message: string) => void;
}

const toastError = (message: string) => usePhoneUiStore.getState().showToast(message, 'error');

export function createPhoneEditSession(label: string, options: PhoneEditSessionOptions = {}): PhoneEditSession {
  const report = options.onError ?? toastError;
  let gesture: { id: number; token: TransactionToken } | null = null;
  let legacyBatch: { opened: boolean } | null = null;
  let chain: Promise<void> = Promise.resolve();
  let changed = false;
  let closed = false;

  const repository = () => getEditorRepositorySession() !== null;
  const gestureAlive = () => gesture !== null && ownsEditorTransaction(gesture.token);

  const open = () => {
    if (gesture && !gestureAlive()) {
      // Only a project switch or a failed transaction ends an explicit gesture; its changes are gone.
      gesture = null;
      if (changed) {
        log.warn(`${label}: the open transaction was lost; earlier changes were discarded`);
        report(`${label}: earlier changes in this sheet were discarded. Check the result before Done.`);
      }
    }
    if (gesture || legacyBatch) return;
    if (repository()) {
      const opened = beginEditorGesture(label, { explicit: true });
      if (opened.token && opened.batchId !== null) gesture = { id: opened.batchId, token: opened.token };
    } else {
      legacyBatch = { opened: startBatch(label).opened };
    }
  };

  const runInside = async (change: Change) => {
    if (gestureAlive()) {
      const { id, token } = gesture!;
      await captureEditorTransactionAcrossAwaits(token, async () => { await runEditorGesture(id, change); });
      return;
    }
    await change();
  };

  const apply = (change: Change) => {
    if (closed) return chain;
    chain = chain.then(async () => {
      if (closed) return;
      open();
      changed = true;
      await runInside(change);
    }).catch((error) => {
      log.warn(`${label}: live change failed`, error);
      report(`${label}: the change failed${error instanceof Error && error.message ? ` (${error.message})` : ''}.`);
    });
    return chain;
  };

  const rollback = () => {
    if (gestureAlive()) { finishEditorGesture(gesture!.id, true); return; }
    if (legacyBatch?.opened) { cancelHistoryBatch(); return; }
    // Someone else owned the history batch: our changes stay in theirs. Say so instead of failing silently.
    if (changed) log.warn(`${label}: no own transaction to roll back; the changes stay in the surrounding batch`);
  };

  const commit = async (finalChange?: Change): Promise<PhoneActionResult> => {
    if (closed) return { ok: false, message: `${label} was already closed.` };
    await chain;
    closed = true;
    const lost = changed && gesture !== null && !gestureAlive();
    if (lost && !finalChange) {
      log.warn(`${label}: the open transaction was lost before Done; nothing to keep`);
      return { ok: false, message: `${label}: the changes were discarded before Done. Please make them again.` };
    }
    try {
      if (gestureAlive()) {
        if (finalChange) await runInside(finalChange);
        finishEditorGesture(gesture!.id);
      } else if (repository()) {
        // The live gesture was ended by the platform (or nothing changed yet): one batch with the final state.
        if (finalChange) await runEditorBatch(label, async () => { await finalChange(); });
      } else {
        if (finalChange && !legacyBatch) legacyBatch = { opened: startBatch(label).opened };
        if (finalChange) await finalChange();
        if (legacyBatch?.opened) endBatch();
      }
      return { ok: true };
    } catch (error) {
      log.error(`${label}: commit failed`, error);
      try { rollback(); } catch (rollbackError) { log.error(`${label}: rollback failed`, rollbackError); }
      return { ok: false, message: `${label} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  const cancel = () => {
    if (closed) return;
    closed = true;
    if (!changed) return;
    // Let an in-flight change finish first so the rollback covers it too.
    chain = chain.then(() => {
      try { rollback(); } catch (error) { log.error(`${label}: cancel failed`, error); }
    });
  };

  return {
    label, apply, commit, cancel,
    get changed() { return changed; },
    get closed() { return closed; },
  };
}

/** One session per sheet mount; a sheet that unmounts without Done is cancelled (rolled back). */
export function usePhoneEditSession(label: string, options?: PhoneEditSessionOptions): PhoneEditSession {
  const sessionRef = useRef<PhoneEditSession | null>(null);
  sessionRef.current ??= createPhoneEditSession(label, options);
  const session = sessionRef.current;
  useEffect(() => () => session.cancel(), [session]);
  return session;
}
