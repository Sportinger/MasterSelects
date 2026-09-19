import { useSettingsStore } from '../../../stores/settingsStore';
import type { TimelineTrack } from '../../../types/timeline';
import {
  getResolveTimelineTrackColor,
  getTimelineTrackColor,
  TIMELINE_TRACK_COLOR_HIDDEN,
} from '../trackColor';

interface TimelineHeaderResolvePresentationInput {
  showTimelineTrackColor: boolean;
  targetTrackId?: string;
  track: TimelineTrack;
  tracks: readonly TimelineTrack[];
  trackTypeIndex: number;
}

export function useTimelineHeaderResolvePresentation({
  showTimelineTrackColor,
  targetTrackId,
  track,
  tracks,
  trackTypeIndex,
}: TimelineHeaderResolvePresentationInput) {
  const resolveThemeActive = useSettingsStore((state) => state.theme === 'resolve');
  const trackColor = showTimelineTrackColor
    ? resolveThemeActive
      ? getResolveTimelineTrackColor(track, trackTypeIndex)
      : getTimelineTrackColor(track, trackTypeIndex)
    : TIMELINE_TRACK_COLOR_HIDDEN;
  const parsedTrackNumber = Number(track.name.match(/(\d+)\s*$/)?.[1]);
  const resolveTrackOrdinal = Number.isFinite(parsedTrackNumber) && parsedTrackNumber > 0
    ? parsedTrackNumber
    : track.type === 'video'
      ? Math.max(1, tracks.filter((candidate) => candidate.type === 'video').length - trackTypeIndex)
      : Math.max(1, trackTypeIndex + 1);
  const resolveTrackCode = track.type === 'video'
    ? `V${resolveTrackOrdinal}`
    : track.type === 'audio'
      ? `A${resolveTrackOrdinal}`
      : `M${resolveTrackOrdinal}`;
  const isResolvePrimaryTargetFallback = resolveThemeActive && !targetTrackId && (
    (track.type === 'video' && resolveTrackOrdinal === 1)
    || (track.type === 'audio' && resolveTrackOrdinal === 1)
  );

  return { isResolvePrimaryTargetFallback, resolveTrackCode, trackColor };
}
