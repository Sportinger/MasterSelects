import type { TimelineTrack } from '../../types';
import type { LabelColor } from '../../stores/mediaStore/types';
import { getLabelHex } from '../panels/media/labelColors';

const COLORLESS_TRACK_COLOR = '#303030';
// MIDI tracks without a custom label color use the shared MIDI identity color so
// the canvas-drawn clip body matches the MIDI track-header tint. Keep this hex in
// sync with `--midi-color` in src/styles/tokens.css (introduced in aa3e21d1; the
// clip body lost it when #228 moved clips from the `.timeline-clip.midi` DOM rule
// to the canvas renderer, which fills from this resolver).
const MIDI_TRACK_COLOR = '#3a4050';
export const TIMELINE_TRACK_COLOR_HIDDEN = 'transparent';

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

  return COLORLESS_TRACK_COLOR;
}
