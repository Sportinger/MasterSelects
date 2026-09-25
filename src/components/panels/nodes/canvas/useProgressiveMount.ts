import { useEffect, useState } from 'react';

/**
 * Invisible DOM hit targets return after a fold animation. Mounting hundreds of
 * cards and cables in one commit froze large graphs for several hundred ms, so
 * they mount in per-frame batches once `active` turns on; the canvas already
 * shows the settled graph.
 */
export function useProgressiveMount(total: number, active: boolean, batch = 48): number {
  const [count, setCount] = useState(active ? total : 0);
  useEffect(() => {
    if (!active) { setCount(0); return; }
    let frame = 0;
    const step = () => setCount(previous => {
      const next = Math.min(total, previous + batch);
      if (next < total) frame = requestAnimationFrame(step);
      return next;
    });
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, total, batch]);
  return active ? Math.min(count, total) : 0;
}
