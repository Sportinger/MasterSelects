import { useCallback } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack } from '../../../types';
import { getTimelineTrackBaseHeight } from '../utils/timelineAudioLayout';

interface UseTimelineTrackHeightWheelProps {
  trackMap: Map<string, TimelineTrack>;
  onSynchronousTrackScaleStep?: (sectionKind: 'video' | 'audio') => void;
}

export function useTimelineTrackHeightWheel({
  trackMap,
  onSynchronousTrackScaleStep,
}: UseTimelineTrackHeightWheelProps): (event: ReactWheelEvent, trackId: string) => void {
  return useCallback(
    (event: ReactWheelEvent, trackId: string) => {
      const track = trackMap.get(trackId);
      if (!track) return;

      const wheelDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (wheelDelta === 0) return;

      const timelineState = useTimelineStore.getState();
      const currentTrack = timelineState.tracks.find(candidate => candidate.id === trackId) ?? track;
      const visibleBaseHeight = getTimelineTrackBaseHeight(
        currentTrack,
        timelineState.audioDisplayMode,
        timelineState.audioFocusMode,
      );
      const resizeBaseHeight = Math.max(currentTrack.height, visibleBaseHeight);
      const scaleBaselineHeight = visibleBaseHeight > currentTrack.height ? visibleBaseHeight : undefined;

      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = -wheelDelta * 0.05;
        onSynchronousTrackScaleStep?.(currentTrack.type === 'video' ? 'video' : 'audio');
        timelineState.scaleTracksOfType(currentTrack.type, delta, scaleBaselineHeight);
      } else if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = -wheelDelta * 0.05;
        timelineState.setTrackHeight(trackId, resizeBaseHeight + delta);
      }
    },
    [onSynchronousTrackScaleStep, trackMap],
  );
}
