import { useTimelineStore } from '../../../stores/timeline';

interface TimelineCurrentTimeValueProps {
  formatTime: (seconds: number) => string;
  frameRate: number;
  inPoint: number | null;
  rangeDuration: number;
  rangeActive: boolean;
  fallbackTime: number;
  fallbackFrame: number;
  totalFrames: number;
  displayMode: 'time' | 'frames';
}

/** Keep clock ticks local to the text, outside the Timeline editing tree. */
export function TimelineCurrentTimeValue({
  formatTime, frameRate, inPoint, rangeDuration, rangeActive,
  fallbackTime, fallbackFrame, totalFrames, displayMode,
}: TimelineCurrentTimeValueProps) {
  const livePosition = useTimelineStore(state => (
    state.isPlaying || state.isDraggingPlayhead ? state.playheadPosition : null
  ));
  const time = livePosition === null ? fallbackTime : rangeActive
    ? Math.max(0, Math.min(livePosition - (inPoint ?? 0), rangeDuration))
    : livePosition;
  const frame = livePosition === null ? fallbackFrame
    : Math.max(0, Math.min(totalFrames, Math.floor(time * frameRate + Number.EPSILON)));
  return <>{displayMode === 'frames' ? frame : formatTime(time)}</>;
}
