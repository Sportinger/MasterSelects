import type { TimelineTrack } from '../../../types';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';

const AUDIO_MODE_MIN_BASE_HEIGHT: Record<TimelineAudioDisplayMode, number> = {
  compact: 0,
  detailed: 0,
  spectral: 0,
};

const AUDIO_FOCUS_MIN_BASE_HEIGHT: Record<TimelineAudioDisplayMode, number> = {
  compact: 96,
  detailed: 144,
  spectral: 180,
};

const AUDIO_FOCUS_VIDEO_CONTEXT_HEIGHT = 32;

function normalizeAudioTrackHeight(height: number): number {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function getTimelineTrackBaseHeight(
  track: Pick<TimelineTrack, 'type' | 'height'>,
  audioDisplayMode: TimelineAudioDisplayMode,
  audioFocusMode = false,
): number {
  if (track.type !== 'audio') {
    if (!audioFocusMode) return track.height;
    return Math.max(20, Math.min(normalizeAudioTrackHeight(track.height), AUDIO_FOCUS_VIDEO_CONTEXT_HEIGHT));
  }

  const minHeight = audioFocusMode
    ? AUDIO_FOCUS_MIN_BASE_HEIGHT[audioDisplayMode]
    : AUDIO_MODE_MIN_BASE_HEIGHT[audioDisplayMode];

  return Math.max(
    normalizeAudioTrackHeight(track.height),
    minHeight,
  );
}
