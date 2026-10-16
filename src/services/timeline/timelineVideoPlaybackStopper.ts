// Synchronous video stop hook for timeline pause/stop.
//
// The per-frame video sync only notices a stop on its next render. On heavy
// frames (4K HTML video) that can be hundreds of milliseconds later, so the
// video kept running past the stop position. Video sync registers here and
// freezes its playing elements in the same task as the store's pause.

type TimelineVideoPlaybackStopper = () => void;

const stoppers = new Set<TimelineVideoPlaybackStopper>();

export function registerTimelineVideoPlaybackStopper(stopper: TimelineVideoPlaybackStopper): () => void {
  stoppers.add(stopper);
  return () => {
    stoppers.delete(stopper);
  };
}

export function stopTimelineVideoPlayback(): void {
  for (const stopper of stoppers) {
    try {
      stopper();
    } catch (error) {
      console.warn('[TimelineVideoPlaybackStopper] stopper failed', error);
    }
  }
}
