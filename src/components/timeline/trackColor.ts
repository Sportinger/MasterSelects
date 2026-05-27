import type { TimelineTrack } from '../../types';
import type { LabelColor } from '../../stores/mediaStore/types';
import { getLabelHex } from '../panels/media/labelColors';

const COLORLESS_TRACK_COLOR = '#303030';
export const TIMELINE_TRACK_COLOR_HIDDEN = 'transparent';

export function getTrackLabelColor(track: Pick<TimelineTrack, 'labelColor'> | null | undefined): LabelColor {
  return track?.labelColor ?? 'none';
}

export function getTimelineTrackColor(track: Pick<TimelineTrack, 'labelColor'>, _index?: number): string {
  if (track.labelColor && track.labelColor !== 'none') {
    return getLabelHex(track.labelColor);
  }

  return COLORLESS_TRACK_COLOR;
}
