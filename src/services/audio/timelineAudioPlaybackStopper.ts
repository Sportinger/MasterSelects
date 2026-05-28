let stopTimelineAudioPlaybackCallback: (() => void) | null = null;

export function registerTimelineAudioPlaybackStopper(callback: () => void): () => void {
  stopTimelineAudioPlaybackCallback = callback;
  return () => {
    if (stopTimelineAudioPlaybackCallback === callback) {
      stopTimelineAudioPlaybackCallback = null;
    }
  };
}

export function stopTimelineAudioPlayback(): void {
  stopTimelineAudioPlaybackCallback?.();
}
