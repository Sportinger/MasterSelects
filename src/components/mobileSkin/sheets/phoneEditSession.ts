// One owned, cancellable transaction per editing sheet (effects, adjust, speed, volume, mask, …).
// Live changes while the sheet is open land in that transaction (a repository gesture, or a legacy
// history batch without a repository): Done commits everything as ONE undo step, Cancel rolls it back
// to the exact state before the sheet opened, without calling undo.
//
// Changes should SET absolute values ("brightness = 0.4"), not add deltas: the editor may end an open
// gesture on window blur, and the next change then opens a fresh one that must carry the full state.
// commit(finalChange) re-applies the final state inside the session for the same reason.

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

export function createPhoneEditSession(label: string): PhoneEditSession {
  let gesture: { id: number; token: TransactionToken } | null = null;
  let legacyBatch: { opened: boolean } | null = null;
  let chain: Promise<void> = Promise.resolve();
  let changed = false;
  let closed = false;

  const repository = () => getEditorRepositorySession() !== null;
  const gestureAlive = () => gesture !== null && ownsEditorTransaction(gesture.token);

  const open = () => {
    // The editor ends open gestures on window blur; start a fresh one instead of writing outside any.
    if (gesture && !gestureAlive()) gesture = null;
    if (gesture || legacyBatch) return;
    if (repository()) {
      const opened = beginEditorGesture(label);
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
export function usePhoneEditSession(label: string): PhoneEditSession {
  const sessionRef = useRef<PhoneEditSession | null>(null);
  sessionRef.current ??= createPhoneEditSession(label);
  const session = sessionRef.current;
  useEffect(() => () => session.cancel(), [session]);
  return session;
}
