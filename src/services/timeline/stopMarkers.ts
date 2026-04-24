import type { TimelineMarker } from '../../stores/timeline/types';

const STOP_MARKER_EPSILON = 1 / 240;

export function findStopMarkerInPlaybackRange(
  markers: TimelineMarker[],
  fromTime: number,
  toTime: number
): TimelineMarker | null {
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    return null;
  }

  if (Math.abs(toTime - fromTime) <= STOP_MARKER_EPSILON) {
    return null;
  }

  if (toTime > fromTime) {
    return markers.find((marker) => (
      marker.stopPlayback === true
      && marker.time > fromTime + STOP_MARKER_EPSILON
      && marker.time <= toTime + STOP_MARKER_EPSILON
    )) ?? null;
  }

  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index];
    if (
      marker.stopPlayback === true
      && marker.time < fromTime - STOP_MARKER_EPSILON
      && marker.time >= toTime - STOP_MARKER_EPSILON
    ) {
      return marker;
    }
  }

  return null;
}
