import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react';
import { TimelineControls } from '../TimelineControls';
import type { TimelineControlsProps } from '../types';
import { useLegacyTransitionCompositionUpgrade } from '../hooks/useLegacyTransitionCompositionUpgrade';

interface TimelineToolbarChromeProps {
  duration: number;
  formatTime: (seconds: number) => string;
  hasInOutDisplayRange: boolean;
  inOutDisplayDuration: number;
  isEditingTimelineDuration: boolean;
  onTimelineDurationClick: () => void;
  onTimelineDurationInputChange: (value: string) => void;
  onTimelineDurationKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onTimelineDurationSubmit: () => void;
  onTimelineTimeDoubleClick: (event: MouseEvent<HTMLSpanElement>) => void;
  slotGridProgress: number;
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  timelineCurrentFrame: number;
  timelineDurationInputRef: RefObject<HTMLInputElement | null>;
  timelineDurationInputValue: string;
  timelineFpsValue: string;
  timelineRulerCurrentTime: number;
  timelineTimeDisplayMode: 'time' | 'frames';
  timelineTotalFrames: number;
}

export function TimelineToolbarChrome({
  duration,
  formatTime,
  hasInOutDisplayRange,
  inOutDisplayDuration,
  isEditingTimelineDuration,
  onTimelineDurationClick,
  onTimelineDurationInputChange,
  onTimelineDurationKeyDown,
  onTimelineDurationSubmit,
  onTimelineTimeDoubleClick,
  slotGridProgress,
  timelineControlsProps,
  timelineCurrentFrame,
  timelineDurationInputRef,
  timelineDurationInputValue,
  timelineFpsValue,
  timelineRulerCurrentTime,
  timelineTimeDisplayMode,
  timelineTotalFrames,
}: TimelineToolbarChromeProps) {
  const upgradeLegacyTransitionComposition = useLegacyTransitionCompositionUpgrade();
  const toolbarStyle = slotGridProgress > 0 ? {
    height: `${Math.round((1 - slotGridProgress) * 36)}px`,
    opacity: 1 - slotGridProgress,
    overflow: 'hidden',
  } : undefined;

  return (
    <div className="toolbar-slide-wrapper" style={toolbarStyle}>
      <div className="timeline-timebar">
        <div
          className={`timeline-ruler-timecode ${timelineTimeDisplayMode === 'frames' ? 'frames' : 'time'}`}
          title="Current time / composition duration"
        >
          {timelineTimeDisplayMode === 'frames' && (
            <span className="timeline-ruler-fps-value" title={`Composition frame rate: ${timelineFpsValue} fps`}>
              <span className="timeline-ruler-fps-number">{timelineFpsValue}</span>
              <span className="timeline-ruler-fps-unit">fps</span>
            </span>
          )}
          <span
            className="timeline-ruler-current-time"
            onDoubleClick={onTimelineTimeDoubleClick}
            title={timelineTimeDisplayMode === 'frames'
              ? 'Double-click to show timecode'
              : hasInOutDisplayRange
                ? 'Current time from In point - double-click to show frames'
                : 'Current composition time - double-click to show frames'}
          >
            {timelineTimeDisplayMode === 'frames' ? timelineCurrentFrame : formatTime(timelineRulerCurrentTime)}
          </span>
          <span className="timeline-ruler-separator-wrap" aria-hidden="true">
            <span className="timeline-ruler-time-separator">/</span>
          </span>
          {isEditingTimelineDuration && !hasInOutDisplayRange ? (
            <input
              ref={timelineDurationInputRef}
              type="text"
              className="timeline-ruler-duration-input"
              value={timelineDurationInputValue}
              style={{ '--timeline-duration-input-ch': `${Math.max(timelineDurationInputValue.length, 8)}ch` } as CSSProperties}
              onChange={(event) => onTimelineDurationInputChange(event.target.value)}
              onKeyDown={onTimelineDurationKeyDown}
              onBlur={onTimelineDurationSubmit}
            />
          ) : hasInOutDisplayRange ? (
            <span
              className="timeline-ruler-duration range"
              title="In/Out range duration"
            >
              {timelineTimeDisplayMode === 'frames' ? timelineTotalFrames : formatTime(inOutDisplayDuration)}
            </span>
          ) : (
            <button
              className="timeline-ruler-duration"
              type="button"
              onClick={onTimelineDurationClick}
              title="Click to edit composition duration"
            >
              {timelineTimeDisplayMode === 'frames' ? timelineTotalFrames : formatTime(duration)}
            </button>
          )}
        </div>
        <TimelineControls variant="transport" {...timelineControlsProps} />
        <TimelineControls variant="utility" {...timelineControlsProps} />
        <TimelineControls variant="zoom" {...timelineControlsProps} />
        {upgradeLegacyTransitionComposition && (
          <button
            className="timeline-ruler-duration"
            type="button"
            onClick={() => void upgradeLegacyTransitionComposition()}
            title="Upgrade this transition to mapped sources"
          >
            Upgrade sources
          </button>
        )}
      </div>
    </div>
  );
}
