import { useCallback, useEffect, useRef } from 'react';

/** Keep only the newest drag sample until the next paint. Flush before ending
 * the undo batch so pointer-up never loses the final authored value. */
export function useFrameCoalescedNumberChange(onChange: (value: number) => void) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const pending = useRef<{ value: number; commit: (value: number) => void } | null>(null);
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const sample = pending.current;
    pending.current = null;
    sample?.commit(sample.value);
  }, []);
  const enqueue = useCallback((value: number) => {
    // Capture the target at input time, not when the queued frame runs: a
    // selection change must never redirect an old drag into another clip.
    pending.current = { value, commit: callback.current };
    frame.current ??= requestAnimationFrame(flush);
  }, [flush]);
  useEffect(() => flush, [flush]);
  return { enqueue, flush };
}
