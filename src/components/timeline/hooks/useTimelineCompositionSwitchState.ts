import { useCallback, useMemo } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack as TimelineTrackType } from '../../../types';
import { buildCompositionSwitchTracks } from '../utils/timelineCompositionSwitchTracks';

type TimelineClipAnimationPhase = 'idle' | 'exiting' | 'entering';
type TimelineCompositionSwitchDirection = 'forward' | 'backward';

interface UseTimelineCompositionSwitchStateProps {
  tracks: TimelineTrackType[];
  expandedTracks: Set<string>;
}

interface UseTimelineCompositionSwitchStateReturn {
  clipAnimationPhase: TimelineClipAnimationPhase;
  compositionSwitchDirection: TimelineCompositionSwitchDirection;
  isCompositionTrackMorphing: boolean;
  isTrackExpandedFromState: (trackId: string) => boolean;
  isTrackExpandedForRender: (trackId: string) => boolean;
  timelineSwitchMotionClass: string;
  timelineViewTracks: TimelineTrackType[];
}

export function useTimelineCompositionSwitchState({
  tracks,
  expandedTracks,
}: UseTimelineCompositionSwitchStateProps): UseTimelineCompositionSwitchStateReturn {
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const compositionSwitchSourceTracks = useTimelineStore(s => s.compositionSwitchSourceTracks);
  const compositionSwitchTargetTracks = useTimelineStore(s => s.compositionSwitchTargetTracks);
  const isCompositionTrackMorphing = clipAnimationPhase !== 'idle'
    && compositionSwitchSourceTracks !== null
    && compositionSwitchTargetTracks !== null;

  const isTrackExpandedFromState = useCallback(
    (trackId: string) => expandedTracks.has(trackId),
    [expandedTracks],
  );
  const isTrackExpandedForRender = useCallback(
    (trackId: string) => !isCompositionTrackMorphing && expandedTracks.has(trackId),
    [expandedTracks, isCompositionTrackMorphing],
  );
  const timelineSwitchMotionClass = clipAnimationPhase === 'exiting'
    ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-exit-left' : 'timeline-switch-exit-right')
    : clipAnimationPhase === 'entering'
      ? (compositionSwitchDirection === 'backward' ? 'timeline-switch-enter-right' : 'timeline-switch-enter-left')
      : '';
  const timelineViewTracks = useMemo(
    () => isCompositionTrackMorphing
      ? buildCompositionSwitchTracks(
          tracks,
          compositionSwitchTargetTracks
        )
      : tracks,
    [compositionSwitchTargetTracks, isCompositionTrackMorphing, tracks]
  );

  return {
    clipAnimationPhase,
    compositionSwitchDirection,
    isCompositionTrackMorphing,
    isTrackExpandedFromState,
    isTrackExpandedForRender,
    timelineSwitchMotionClass,
    timelineViewTracks,
  };
}
