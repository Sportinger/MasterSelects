let playbackSuppressed = false;

export function isTimelineWaveformWarmupPlaybackSuppressed(): boolean {
  return playbackSuppressed;
}

export function setTimelineWaveformWarmupPlaybackSuppressed(suppressed: boolean): void {
  playbackSuppressed = suppressed;
}

