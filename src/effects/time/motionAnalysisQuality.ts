import { useTimelineStore } from '../../stores/timeline';
import { isCollectingTemporalPreparations } from './temporalResourcePreparation';

/** Only the motion estimate changes size; scan samples and the result do not.
 * Export owns an explicit preparation scope and always uses the full field. */
export function motionAnalysisMaxEdge(): number {
  if (isCollectingTemporalPreparations()) return 320;
  const timeline = useTimelineStore.getState();
  return timeline.isPlaying || timeline.isDraggingPlayhead ? 80 : 320;
}
