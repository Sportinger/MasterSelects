import type { TimelineTrack } from '../../../types';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';

const AUDIO_MODE_MIN_BASE_HEIGHT: Record<TimelineAudioDisplayMode, number> = {
  compact: 0,
  detailed: 72,
  spectral: 128,
};

function normalizeAudioTrackHeight(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function getTimelineTrackBaseHeight(
  track: Pick<TimelineTrack, 'type' | 'height'>,
  audioDisplayMode: TimelineAudioDisplayMode,
): number {
  if (track.type !== 'audio') {
    return track.height;
  }

  return Math.max(
    normalizeAudioTrackHeight(track.height),
    AUDIO_MODE_MIN_BASE_HEIGHT[audioDisplayMode],
  );
}
