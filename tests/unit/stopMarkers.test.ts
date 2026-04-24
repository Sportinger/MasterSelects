import { describe, expect, it } from 'vitest';
import { findStopMarkerInPlaybackRange } from '../../src/services/timeline/stopMarkers';
import type { TimelineMarker } from '../../src/stores/timeline/types';

describe('findStopMarkerInPlaybackRange', () => {
  const markers: TimelineMarker[] = [
    { id: 'marker-a', time: 3, label: 'A', color: '#fff' },
    { id: 'marker-b', time: 5, label: 'B', color: '#fff', stopPlayback: true },
    { id: 'marker-c', time: 8, label: 'C', color: '#fff', stopPlayback: true },
  ];

  it('finds the first forward stop marker crossed by playback', () => {
    expect(findStopMarkerInPlaybackRange(markers, 4.4, 6.2)?.id).toBe('marker-b');
  });

  it('finds the nearest reverse stop marker crossed by playback', () => {
    expect(findStopMarkerInPlaybackRange(markers, 8.4, 4.6)?.id).toBe('marker-c');
  });

  it('does not retrigger when playback starts exactly on a stop marker', () => {
    expect(findStopMarkerInPlaybackRange(markers, 5, 5.01)).toBeNull();
  });
});
