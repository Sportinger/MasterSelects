import { useTimelineStore } from '../../stores/timeline';
import { useTimelineDurationEditor } from '../timeline/hooks/useTimelineDurationEditor';
import { formatTimelineClock } from '../timeline/utils/timelineGrid';
import { parseTimelineClock } from '../timeline/utils/parseTimelineClock';
import './PreviewTimeDisplay.css';

interface PreviewTimeDisplayProps {
  duration: number;
  playheadPosition: number;
  inPoint: number | null;
  outPoint: number | null;
  frameRate: number;
}

/** Composition clock and editable duration share the preview's transport row. */
export function PreviewTimeDisplay(props: PreviewTimeDisplayProps) {
  const setDuration = useTimelineStore(state => state.setDuration);
  const time = useTimelineDurationEditor({
    ...props, setDuration, formatTime: formatTimelineClock, parseTime: parseTimelineClock,
  });
  const frames = time.timelineTimeDisplayMode === 'frames';
  return (
    <div className="preview-time-display" data-guided-target="timeline-timecode" aria-label="Current time / composition duration">
      {frames && <span className="preview-time-fps">{time.timelineFpsValue}<small>fps</small></span>}
      <button
        className="preview-time-value"
        type="button"
        aria-label={frames ? 'Current frame; switch to time' : 'Current time; switch to frames'}
        title={frames ? 'Double-click to show time' : 'Double-click to show frames'}
        onDoubleClick={time.handleTimelineTimeDoubleClick}
        onClick={event => { if (event.detail === 0) time.handleTimelineTimeDoubleClick(event); }}
      >
        {frames ? time.timelineCurrentFrame : formatTimelineClock(time.timelineRulerCurrentTime)}
      </button>
      <span className="preview-time-separator" aria-hidden="true">/</span>
      {time.isEditingTimelineDuration ? (
        <input
          ref={time.timelineDurationInputRef}
          aria-label="Composition duration"
          className="preview-duration-input"
          value={time.timelineDurationInputValue}
          onChange={event => time.handleTimelineDurationInputChange(event.target.value)}
          onKeyDown={event => {
            event.stopPropagation();
            time.handleTimelineDurationKeyDown(event);
          }}
          onBlur={time.handleTimelineDurationSubmit}
        />
      ) : time.hasInOutDisplayRange ? (
        <span className="preview-time-range" title="In/Out range duration">
          {frames ? time.timelineTotalFrames : formatTimelineClock(time.inOutDisplayDuration)}
        </span>
      ) : (
        <button className="preview-time-value" type="button"
          title="Click to edit composition duration" aria-label="Edit composition duration"
          onClick={time.handleTimelineDurationClick}>
          {frames ? time.timelineTotalFrames : formatTimelineClock(props.duration)}
        </button>
      )}
    </div>
  );
}
