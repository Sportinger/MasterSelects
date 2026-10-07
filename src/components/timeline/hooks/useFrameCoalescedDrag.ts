import { useEffect, useMemo, useRef } from 'react';
import { bindEditorGestureCallback } from '../../../services/project/repository/transaction/editorGestureOwnership';

/** Keep only the latest pointer sample, flush it before commit, discard it on cancellation. */
export function useFrameCoalescedDrag<T extends unknown[]>(onMove: (...args: T) => void) {
  const latest = useRef(onMove);
  latest.current = onMove;
  const queue = useMemo(() => {
    let frame: number | null = null;
    let pending: (() => void) | null = null;
    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = null;
    };
    const flush = () => {
      const apply = pending;
      cancel();
      apply?.();
    };
    return {
      push: (...args: T) => {
        pending = bindEditorGestureCallback(() => latest.current(...args));
        if (frame === null) frame = requestAnimationFrame(flush);
      },
      flush,
      cancel,
    };
  }, []);
  useEffect(() => queue.cancel, [queue]);
  return queue;
}
