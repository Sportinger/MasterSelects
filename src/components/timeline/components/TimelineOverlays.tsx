// Timeline overlay elements (markers, work area, cache indicators, etc.)

import '../TimelineInteractions.css';
import React, { useEffect, useState } from 'react';
import { IconFlag3Filled } from '@tabler/icons-react';
import type { ClipDragState, ClipTrimState } from '../types';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { isAudioRecordingActivePhase } from '../../../services/audio/timelineRecordingWorkflow';

interface TimelineOverlaysProps {
  // Time conversion
  timeToPixel: (time: number) => number;
  formatTime: (seconds: number) => string;
  scrollX: number;

  // In/Out points
  inPoint: number | null;
  outPoint: number | null;
  duration: number;
  markerDrag: { type: 'in' | 'out' } | null;
  onMarkerMouseDown: (e: React.MouseEvent, type: 'in' | 'out') => void;
  onMarkerContextMenu?: (e: React.MouseEvent, type: 'in' | 'out') => void;
  switchMotionClass?: string;
  renderMode?: 'all' | 'trackOverlays' | 'rangeMarkers';
  inLineOpacity?: number;
  outLineOpacity?: number;

  // Clip drag
  clipDrag: ClipDragState | null;

  // Clip trim (for the snap line while trimming an edge)
  clipTrim?: ClipTrimState | null;

  // RAM preview
  isRamPreviewing: boolean;
  ramPreviewProgress: number | null;
  playheadPosition: number;

  // Export
  isExporting: boolean;
  exportProgress: number | null;
  exportRange: { start: number; end: number } | null;

  // Cache
  getCachedRanges: () => { start: number; end: number }[];
}

export function TimelineOverlays({
  timeToPixel,
  formatTime,
  scrollX,
  inPoint,
  outPoint,
  duration,
  markerDrag,
  onMarkerMouseDown,
  onMarkerContextMenu,
  switchMotionClass = '',
  renderMode = 'all',
  inLineOpacity = 1,
  outLineOpacity = 1,
  clipDrag,
  clipTrim,
  isRamPreviewing,
  ramPreviewProgress,
  playheadPosition,
  isExporting,
  exportProgress,
  exportRange,
  getCachedRanges,
}: TimelineOverlaysProps) {
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  const timeToViewportPixel = (time: number) => timeToPixel(time) - scrollX;
  const renderTrackOverlays = renderMode !== 'rangeMarkers';
  const renderRangeMarkers = renderMode !== 'trackOverlays';

  const recordingPunchStart = recordingState.punchInTime ?? recordingState.startTime;
  const recordingPunchEnd = recordingState.punchOutTime;
  const recordingPunchActive = isAudioRecordingActivePhase(recordingState.phase)
    && recordingPunchStart !== undefined
    && recordingPunchEnd !== undefined
    && recordingPunchEnd > recordingPunchStart;

  return (
    <>
      {/* Snap line */}
      {renderTrackOverlays && clipDrag?.isSnapping && clipDrag.snapIndicatorTime !== null && (
        <div className="snap-line" style={{ left: timeToViewportPixel(clipDrag.snapIndicatorTime) }} />
      )}
      {/* Snap line while trimming a clip edge */}
      {renderTrackOverlays && clipTrim?.isSnapping && clipTrim.snapIndicatorTime !== null && clipTrim.snapIndicatorTime !== undefined && (
        <div className="snap-line" style={{ left: timeToViewportPixel(clipTrim.snapIndicatorTime) }} />
      )}
      {/* Guide line at original position when dragging across tracks (dimmer when not snapped) */}
      {renderTrackOverlays && clipDrag && !clipDrag.isSnapping && clipDrag.trackChangeGuideTime !== null && (
        <div className="snap-line snap-line-guide" style={{ left: timeToViewportPixel(clipDrag.trackChangeGuideTime) }} />
      )}

      {/* Work area overlays */}
      {renderTrackOverlays && (inPoint !== null || outPoint !== null) && (
        <>
          {inPoint !== null && inPoint > 0 && (
            <div
              className="work-area-overlay before"
              style={{
                left: timeToViewportPixel(0),
                width: timeToPixel(inPoint),
              }}
            />
          )}
          {outPoint !== null && (
            <div
              className="work-area-overlay after"
              style={{
                left: timeToViewportPixel(outPoint),
                width: timeToPixel(duration - outPoint),
              }}
            />
          )}
        </>
      )}

      {renderTrackOverlays && recordingPunchActive && (
        <div
          className={`timeline-recording-punch-range ${recordingState.phase}`}
          style={{
            left: timeToViewportPixel(recordingPunchStart),
            width: Math.max(2, timeToPixel(recordingPunchEnd - recordingPunchStart)),
          }}
          title={`Recording punch: ${formatTime(recordingPunchStart)} - ${formatTime(recordingPunchEnd)}`}
        />
      )}

      {/* RAM preview progress */}
      {renderTrackOverlays && isRamPreviewing && ramPreviewProgress !== null && (
        <div
          className="ram-preview-progress-text"
          style={{
            left: timeToViewportPixel(playheadPosition) + 10,
          }}
        >
          {Math.round(ramPreviewProgress)}%
        </div>
      )}

      {/* Export Progress Overlay */}
      {renderTrackOverlays && isExporting && exportRange && (
        <>
          {/* Progress bar - grows based on percentage (0-100%) */}
          <div
            className="timeline-export-overlay"
            style={{
              left: timeToViewportPixel(exportRange.start),
              width: timeToPixel(
                (exportRange.end - exportRange.start) * ((exportProgress ?? 0) / 100)
              ),
            }}
          />
          {/* Percentage display - at end of progress bar */}
          <div
            className="timeline-export-text"
            style={{
              left:
                timeToViewportPixel(
                  exportRange.start +
                    (exportRange.end - exportRange.start) * ((exportProgress ?? 0) / 100)
                ) - 10,
              transform: 'translateX(-100%)',
            }}
          >
            {Math.round(exportProgress ?? 0)}%
          </div>
        </>
      )}

      {/* Playback cache indicators (blue) */}
      {renderTrackOverlays && getCachedRanges().map((range, i) => (
        <div
          key={i}
          className="playback-cache-indicator"
          style={{
            left: timeToViewportPixel(range.start),
            width: Math.max(2, timeToPixel(range.end - range.start)),
          }}
          title={`Cached: ${formatTime(range.start)} - ${formatTime(range.end)}`}
        />
      ))}

      {/* In marker */}
      {renderRangeMarkers && inPoint !== null && (
        <div
          className={`in-out-marker in-marker ${recordingPunchActive ? 'recording-punch' : ''} ${switchMotionClass} ${markerDrag?.type === 'in' ? 'dragging' : ''}`}
          style={{
            left: timeToViewportPixel(inPoint),
            '--timeline-line-opacity': markerDrag?.type === 'in' ? 1 : inLineOpacity,
          } as React.CSSProperties}
          title={`In: ${formatTime(inPoint)} (drag to move)`}
          onContextMenu={(e) => onMarkerContextMenu?.(e, 'in')}
        >
          <div
            className="marker-flag"
            onMouseDown={(e) => onMarkerMouseDown(e, 'in')}
          >
            <IconFlag3Filled className="timeline-flag-icon in-flag" aria-hidden="true" />
          </div>
          <div className="marker-line" />
        </div>
      )}

      {/* Out marker */}
      {renderRangeMarkers && outPoint !== null && (
        <div
          className={`in-out-marker out-marker ${recordingPunchActive ? 'recording-punch' : ''} ${switchMotionClass} ${markerDrag?.type === 'out' ? 'dragging' : ''}`}
          style={{
            left: timeToViewportPixel(outPoint),
            '--timeline-line-opacity': markerDrag?.type === 'out' ? 1 : outLineOpacity,
          } as React.CSSProperties}
          title={`Out: ${formatTime(outPoint)} (drag to move)`}
          onContextMenu={(e) => onMarkerContextMenu?.(e, 'out')}
        >
          <div
            className="marker-flag"
            onMouseDown={(e) => onMarkerMouseDown(e, 'out')}
          >
            <IconFlag3Filled className="timeline-flag-icon out-flag" aria-hidden="true" />
          </div>
          <div className="marker-line" />
        </div>
      )}
    </>
  );
}
