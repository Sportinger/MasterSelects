import { useEffect, useMemo, useRef } from 'react';
import { bindEditorGestureCallback } from '../../../services/project/repository/transaction/editorGestureOwnership';

/** Keep only the latest pointer sample, flush it before commit, discard it on cancellation. */
export function useFrameCoalescedDrag<T extends unknown[]>(onMove: (...args: T) => void) {
  const latest = useRef(onMove);
  latest.current = onMove;
  const frame = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const queue = useMemo(() => {
    const cancel = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
    };
    const flush = () => {
      const apply = pending.current;
      cancel();
      apply?.();
    };
    return {
      push: (...args: T) => {
        pending.current = bindEditorGestureCallback(() => latest.current(...args));
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      },
      flush,
      cancel,
    };
  }, []);
  useEffect(() => queue.cancel, [queue]);
  return queue;
}
