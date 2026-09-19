import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { TimelineControls } from '../TimelineControls';
import type { TimelineControlsProps } from '../types';
import { useLegacyTransitionCompositionUpgrade } from '../hooks/useLegacyTransitionCompositionUpgrade';
import { useTimelineOverLayout } from '../hooks/useTimelineOverLayout';
import type { TimelineCurveMode } from '../../../stores/timeline/viewPreferences';

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
  onToggleTimelineCurveMode: () => void;
  slotGridProgress: number;
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  timelineCurrentFrame: number;
  timelineDurationInputRef: RefObject<HTMLInputElement | null>;
  timelineDurationInputValue: string;
  timelineFpsValue: string;
  timelineRulerCurrentTime: number;
  timelineTimeDisplayMode: 'time' | 'frames';
  timelineTotalFrames: number;
  timelineCurveMode: TimelineCurveMode;
}

interface TimelineCurveModeButtonProps {
  onToggle: () => void;
  timelineCurveMode: TimelineCurveMode;
}

function TimelineCurveModeButton({
  onToggle,
  timelineCurveMode,
}: TimelineCurveModeButtonProps) {
  return (
    <button
      aria-label="Toggle Timeline and Graph view"
      aria-pressed={timelineCurveMode === 'graph'}
      className={`timeline-curve-mode-toggle${timelineCurveMode === 'graph' ? ' active' : ''}`}
      data-guided-target="button:timeline-graph-toggle"
      type="button"
      onClick={onToggle}
      title="Toggle Timeline / Graph view (G)"
    >
      <span>{timelineCurveMode === 'graph' ? 'Graph' : 'Timeline'}</span>
      <kbd>G</kbd>
    </button>
  );
}

interface TimelineToolbarOverflowMenuProps extends TimelineCurveModeButtonProps {
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  upgradeLegacyTransitionComposition: (() => void) | null;
}

function TimelineToolbarOverflowMenu({
  onToggle,
  timelineControlsProps,
  timelineCurveMode,
  upgradeLegacyTransitionComposition,
}: TimelineToolbarOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="timeline-toolbar-overflow" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="More timeline controls"
        className={`timeline-toolbar-overflow-toggle${open ? ' active' : ''}`}
        type="button"
        onClick={() => setOpen(current => !current)}
        title="More timeline controls"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          aria-label="More timeline controls"
          className="timeline-toolbar-overflow-menu"
          role="dialog"
        >
          <TimelineControls variant="utility" {...timelineControlsProps} />
          <div className="timeline-toolbar-overflow-divider" />
          <div className="timeline-toolbar-overflow-actions">
            <TimelineControls variant="zoom" {...timelineControlsProps} />
            <TimelineCurveModeButton
              onToggle={onToggle}
              timelineCurveMode={timelineCurveMode}
            />
            {upgradeLegacyTransitionComposition && (
              <button
                className="timeline-ruler-duration timeline-toolbar-upgrade-sources"
                type="button"
                onClick={() => void upgradeLegacyTransitionComposition()}
                title="Upgrade this transition to mapped sources"
              >
                Upgrade sources
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
  onToggleTimelineCurveMode,
  slotGridProgress,
  timelineControlsProps,
  timelineCurrentFrame,
  timelineDurationInputRef,
  timelineDurationInputValue,
  timelineFpsValue,
  timelineRulerCurrentTime,
  timelineTimeDisplayMode,
  timelineTotalFrames,
  timelineCurveMode,
}: TimelineToolbarChromeProps) {
  const upgradeLegacyTransitionComposition = useLegacyTransitionCompositionUpgrade();
  const { isMediumMobileTimelineLayout } = useTimelineOverLayout();
  const toolbarStyle = slotGridProgress > 0 ? {
    height: `${Math.round((1 - slotGridProgress) * 36)}px`,
    opacity: 1 - slotGridProgress,
    overflow: 'hidden',
  } : undefined;

  return (
    <div className="toolbar-slide-wrapper" style={toolbarStyle}>
      <div className="timeline-timebar">
        {isMediumMobileTimelineLayout && (
          <TimelineControls variant="main" {...timelineControlsProps} />
        )}
        <div
          className={`timeline-ruler-timecode ${timelineTimeDisplayMode === 'frames' ? 'frames' : 'time'}`}
          data-guided-target="timeline-timecode"
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
        <TimelineCurveModeButton
          onToggle={onToggleTimelineCurveMode}
          timelineCurveMode={timelineCurveMode}
        />
        {upgradeLegacyTransitionComposition && (
          <button
            className="timeline-ruler-duration timeline-toolbar-upgrade-sources"
            type="button"
            onClick={() => void upgradeLegacyTransitionComposition()}
            title="Upgrade this transition to mapped sources"
          >
            Upgrade sources
          </button>
        )}
        <TimelineToolbarOverflowMenu
          onToggle={onToggleTimelineCurveMode}
          timelineControlsProps={timelineControlsProps}
          timelineCurveMode={timelineCurveMode}
          upgradeLegacyTransitionComposition={upgradeLegacyTransitionComposition}
        />
      </div>
    </div>
  );
}
