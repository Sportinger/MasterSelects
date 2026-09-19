import {
  IconCrop,
  IconFlag,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react';
import type { PointerEvent, RefObject } from 'react';

import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import { SourceMonitorPlacementCommands } from './SourceMonitorPlacementCommands';
import { formatTimecode, type SourceTimelineTick } from './sourceMonitorTimecode';

export type SourceTimelineDragKind = 'playhead' | 'in' | 'out';

interface SourceMonitorTransportControlsProps {
  clearInOut: () => void;
  cropMode: boolean;
  currentTime: number;
  external: boolean;
  fps: number;
  hasMarkedRange: boolean;
  inPoint: number | null;
  isImage: boolean;
  isPlayable: boolean;
  isPlaying: boolean;
  markedDuration: number;
  onPause: () => void;
  onPlay: () => void;
  onRunPlacementCommand: (mode: TimelinePlacementMode) => void;
  onSetInPoint: (time: number) => void;
  onSetOutPoint: (time: number) => void;
  onStartTimelineDrag: (kind: SourceTimelineDragKind, event: PointerEvent) => void;
  onStop: () => void;
  onToggleCrop: () => void;
  outPoint: number | null;
  pendingPlacementMode: TimelinePlacementMode | null;
  progress: number;
  rangeLeft: number;
  rangeRight: number;
  rangeWidth: number;
  showTimingControls: boolean;
  timelineDuration: number;
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineTicks: SourceTimelineTick[];
}

export function SourceMonitorTransportControls({
  clearInOut,
  cropMode,
  currentTime,
  external,
  fps,
  hasMarkedRange,
  inPoint,
  isImage,
  isPlayable,
  isPlaying,
  markedDuration,
  onPause,
  onPlay,
  onRunPlacementCommand,
  onSetInPoint,
  onSetOutPoint,
  onStartTimelineDrag,
  onStop,
  onToggleCrop,
  outPoint,
  pendingPlacementMode,
  progress,
  rangeLeft,
  rangeRight,
  rangeWidth,
  showTimingControls,
  timelineDuration,
  timelineRef,
  timelineTicks,
}: SourceMonitorTransportControlsProps) {
  return (
    <div className={`source-monitor-toolbar${external ? ' source-monitor-toolbar-external' : ''}${!showTimingControls ? ' source-monitor-toolbar-commands-only' : ''}`}>
      {showTimingControls && (
        <div className="source-monitor-timeline-strip">
          <div
            className="source-monitor-timeline"
            ref={timelineRef}
            onPointerDown={(event) => onStartTimelineDrag('playhead', event)}
            aria-label="Source timeline"
          >
            <div className="source-monitor-ruler">
              {timelineTicks.map((tick) => (
                <span
                  key={`${tick.time}-${tick.major ? 'major' : 'minor'}`}
                  className={`source-monitor-ruler-tick ${tick.major ? 'major' : 'minor'}`}
                  style={{ left: `${(tick.time / timelineDuration) * 100}%` }}
                >
                  {tick.label && <span>{tick.label}</span>}
                </span>
              ))}
            </div>
            <div className="source-monitor-timeline-track">
              {hasMarkedRange && (
                <div
                  className="source-monitor-timeline-range"
                  style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
                />
              )}
              <button
                type="button"
                className="source-monitor-mark-handle source-monitor-mark-in"
                style={{ left: `${rangeLeft}%` }}
                onPointerDown={(event) => onStartTimelineDrag('in', event)}
                title="Drag source In"
                aria-label="Drag source In"
              >
                <span>I</span>
              </button>
              <button
                type="button"
                className="source-monitor-mark-handle source-monitor-mark-out"
                style={{ left: `${rangeRight}%` }}
                onPointerDown={(event) => onStartTimelineDrag('out', event)}
                title="Drag source Out"
                aria-label="Drag source Out"
              >
                <span>O</span>
              </button>
              <div className="source-monitor-timeline-fill" style={{ width: `${progress}%` }} />
              <div className="source-monitor-playhead" style={{ left: `${progress}%` }}>
                <span />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`source-monitor-control-row${!showTimingControls ? ' source-monitor-control-row-commands-only' : ''}`}>
        {showTimingControls && (
          <div className="source-monitor-timecode source-monitor-timecode-current">
            {formatTimecode(currentTime, fps)}
          </div>
        )}

        <div className="source-monitor-center-controls">
          {isImage && (
            <button
              className={`btn btn-sm source-monitor-crop-btn ${cropMode ? 'btn-active' : ''}`}
              onClick={onToggleCrop}
              title={cropMode ? 'Exit crop mode' : 'Crop image'}
              aria-label={cropMode ? 'Exit crop mode' : 'Crop image'}
            >
              <IconCrop size={14} aria-hidden="true" />
              <span>Crop</span>
            </button>
          )}

          {showTimingControls && (
            <div className="source-monitor-marks">
              <button
                className={`btn btn-sm ${inPoint !== null ? 'btn-active' : ''}`}
                onClick={() => onSetInPoint(currentTime)}
                title="Set source In"
              >
                <IconFlag size={12} aria-hidden="true" />
                In
              </button>
              <button
                className={`btn btn-sm ${outPoint !== null ? 'btn-active' : ''}`}
                onClick={() => onSetOutPoint(currentTime)}
                title="Set source Out"
              >
                <IconFlag size={12} aria-hidden="true" />
                Out
              </button>
              <button
                className="btn btn-sm source-monitor-icon-btn"
                onClick={clearInOut}
                disabled={inPoint === null && outPoint === null}
                title="Clear source In/Out"
                aria-label="Clear source In/Out"
              >
                <IconX size={13} aria-hidden="true" />
              </button>
            </div>
          )}

          {showTimingControls && isPlayable && (
            <div className="source-monitor-transport">
              <button
                className="btn btn-sm source-monitor-icon-btn"
                onClick={onStop}
                title="Stop"
                aria-label="Stop source"
              >
                <IconPlayerStopFilled size={14} aria-hidden="true" />
              </button>
              <button
                className={`btn btn-sm source-monitor-icon-btn source-monitor-play-button ${isPlaying ? 'btn-active' : ''}`}
                onClick={isPlaying ? onPause : onPlay}
                title={isPlaying ? 'Pause [Space]' : 'Play [Space]'}
                aria-label={isPlaying ? 'Pause source' : 'Play source'}
              >
                {isPlaying
                  ? <IconPlayerPauseFilled size={15} aria-hidden="true" />
                  : <IconPlayerPlayFilled size={15} aria-hidden="true" />
                }
              </button>
            </div>
          )}

          <SourceMonitorPlacementCommands
            pendingPlacementMode={pendingPlacementMode}
            onRunCommand={onRunPlacementCommand}
          />
        </div>

        {showTimingControls && (
          <div className="source-monitor-timecode source-monitor-timecode-duration">
            {formatTimecode(markedDuration, fps)}
          </div>
        )}
      </div>
    </div>
  );
}
