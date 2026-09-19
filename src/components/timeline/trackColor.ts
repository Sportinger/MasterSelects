import type { TimelineTrack } from '../../types';
import type { LabelColor } from '../../stores/mediaStore/types';
import { getLabelHex } from '../panels/media/labelColors';

const COLORLESS_TRACK_COLOR = '#303030';
const DEFAULT_VIDEO_TRACK_COLOR = '#2b4541';
const DEFAULT_AUDIO_TRACK_COLOR = '#2d3b4d';
// MIDI tracks without a custom label color use the shared MIDI identity color so
// the canvas-drawn clip body matches the MIDI track-header tint. Keep this hex in
// sync with `--midi-color` in src/styles/tokens.css (introduced in aa3e21d1; the
// clip body lost it when #228 moved clips from the `.timeline-clip.midi` DOM rule
// to the canvas renderer, which fills from this resolver).
const MIDI_TRACK_COLOR = '#3a4050';
export const TIMELINE_TRACK_COLOR_HIDDEN = 'transparent';

const RESOLVE_VIDEO_TRACK_COLORS = ['rgba(66, 109, 136, 0.94)', 'rgba(223, 109, 11, 0.94)'] as const;
const RESOLVE_AUDIO_TRACK_COLORS = ['rgba(223, 109, 11, 0.94)', 'rgba(67, 135, 99, 0.94)', 'rgba(67, 135, 99, 0.94)'] as const;
const RESOLVE_MIDI_TRACK_COLOR = 'rgba(106, 91, 142, 0.94)';

export function getTrackLabelColor(track: Pick<TimelineTrack, 'labelColor'> | null | undefined): LabelColor {
  return track?.labelColor ?? 'none';
}

export function getTimelineTrackColor(
  track: Pick<TimelineTrack, 'labelColor'> & Partial<Pick<TimelineTrack, 'type'>>,
  _index?: number,
): string {
  if (track.labelColor && track.labelColor !== 'none') {
    return getLabelHex(track.labelColor);
  }

  if (track.type === 'midi') {
    return MIDI_TRACK_COLOR;
  }

  if (track.type === 'video') {
    return DEFAULT_VIDEO_TRACK_COLOR;
  }

  if (track.type === 'audio') {
    return DEFAULT_AUDIO_TRACK_COLOR;
  }

  return COLORLESS_TRACK_COLOR;
}

/**
 * Resolve uses track/clip color as a primary structural cue. Explicit user
 * label colors still win; otherwise the default edit-page stack follows the
 * familiar blue/orange video and orange/green audio grouping.
 */
export function getResolveTimelineTrackColor(
  track: Pick<TimelineTrack, 'labelColor' | 'type'>,
  trackIndex = 0,
): string {
  if (track.labelColor && track.labelColor !== 'none') {
    return getLabelHex(track.labelColor);
  }

  if (track.type === 'video') {
    return RESOLVE_VIDEO_TRACK_COLORS[Math.min(trackIndex, RESOLVE_VIDEO_TRACK_COLORS.length - 1)];
  }
  if (track.type === 'audio') {
    return RESOLVE_AUDIO_TRACK_COLORS[Math.min(trackIndex, RESOLVE_AUDIO_TRACK_COLORS.length - 1)];
  }
  if (track.type === 'midi') return RESOLVE_MIDI_TRACK_COLOR;
  return COLORLESS_TRACK_COLOR;
}
