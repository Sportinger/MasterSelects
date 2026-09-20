import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';

// Bridge pauses between scrub events without keeping a stationary drag animated.
const SCRUB_SETTLE_MS = 180;

/** Presentation activity only: this does not measure node execution or alter the graph. */
export function useNodeFlowActivity() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const clearSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    };
    const setActive = (active: boolean) => {
      // No React renders or per-frame attribute writes while the timeline runs.
      const value = String(active && !document.hidden);
      if (svg.dataset.flowActive !== value) svg.dataset.flowActive = value;
    };
    const onVisibilityChange = () => {
      clearSettle();
      setActive(useTimelineStore.getState().isPlaying);
    };
    onVisibilityChange();
    const unsubscribe = useTimelineStore.subscribe((state, previous) => {
      if (state.isPlaying === previous.isPlaying
        && (state.isPlaying || state.playheadPosition === previous.playheadPosition)) return;
      clearSettle();
      if (document.hidden || state.isPlaying || previous.isPlaying) {
        // Pause/stop may also publish a final playhead position; do not treat it as a scrub.
        setActive(state.isPlaying);
      } else {
        setActive(true);
        settleTimer = setTimeout(() => setActive(false), SCRUB_SETTLE_MS);
      }
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribe();
      clearSettle();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return ref;
}
