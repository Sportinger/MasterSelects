import { useCallback, useEffect, useRef } from 'react';
import { endBatch, startBatch, useHistoryStore } from '../../../../stores/historyStore';

/** Join an enclosing edit transaction, or own exactly one undo step per drag. */
export function useInspectorHistoryBatch(label: string, onStart?: () => void, onEnd?: () => void) {
  const callbacks = useRef({ label, onStart, onEnd });
  callbacks.current = { label, onStart, onEnd };
  const owned = useRef<number | null>(null);
  const finishOwned = useCallback(() => {
    const id = owned.current;
    owned.current = null;
    if (id !== null && useHistoryStore.getState().batchId === id) endBatch();
  }, []);
  const begin = useCallback(() => {
    callbacks.current.onStart?.();
    const batch = startBatch(`Adjust ${callbacks.current.label}`);
    if (batch.opened) owned.current = batch.batchId;
  }, []);
  const end = useCallback(() => {
    finishOwned();
    callbacks.current.onEnd?.();
  }, [finishOwned]);
  useEffect(() => () => {
    // Child number controls flush queued input during their own cleanup.
    // Close only afterwards, and never close a newer owner's transaction.
    const id = owned.current;
    queueMicrotask(() => { if (owned.current === id) finishOwned(); });
  }, [finishOwned]);
  return { begin, end };
}
