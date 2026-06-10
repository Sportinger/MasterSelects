import type {
  CSSProperties,
  MouseEventHandler,
  ReactNode,
  RefObject,
  WheelEventHandler,
} from 'react';
import {
  alignTimelineGridPixel,
  getTimelineDevicePixelRatio,
} from '../utils/timelineGrid';
import type { TrackSectionKind } from '../utils/timelineHostTypes';

interface TimelineTrackSectionFrameProps {
  clipDragActive: boolean;
  duration: number;
  gridSize: number;
  headerContent: ReactNode;
  isExporting: boolean;
  lanesContent: ReactNode;
  marqueeActive: boolean;
  onSectionTracksMouseDown: MouseEventHandler<HTMLDivElement>;
  onSectionWheel: WheelEventHandler<HTMLDivElement>;
  scrollX: number;
  sectionCollapsed: boolean;
  sectionContextTrackHeight: number;
  sectionHeight: number;
  sectionKind: TrackSectionKind;
  sectionPhaseClass: string;
  sectionScrollY: number;
  sectionViewportRef: RefObject<HTMLDivElement | null>;
  frameIntervalPixels: number;
  frameGridOpacity: number;
  gridMode: string;
  timeGridOpacity: number;
  zoom: number;
}

export function TimelineTrackSectionFrame({
  clipDragActive,
  duration,
  gridSize,
  headerContent,
  isExporting,
  lanesContent,
  marqueeActive,
  onSectionTracksMouseDown,
  onSectionWheel,
  scrollX,
  sectionCollapsed,
  sectionContextTrackHeight,
  sectionHeight,
  sectionKind,
  sectionPhaseClass,
  sectionScrollY,
  sectionViewportRef,
  frameIntervalPixels,
  frameGridOpacity,
  gridMode,
  timeGridOpacity,
  zoom,
}: TimelineTrackSectionFrameProps) {
  const devicePixelRatio = getTimelineDevicePixelRatio();
  const alignedScrollX = alignTimelineGridPixel(scrollX, devicePixelRatio);
  const gridLineWidth = 1 / devicePixelRatio;

  return (
    <div
      className={`timeline-track-section ${sectionKind} ${sectionCollapsed ? 'collapsed' : ''}`}
      data-section-kind={sectionKind}
      style={{
        height: sectionHeight,
        '--timeline-focus-context-track-height': `${sectionContextTrackHeight}px`,
      } as CSSProperties & { '--timeline-focus-context-track-height': string }}
    >
      <div
        className="timeline-section-viewport"
        ref={sectionViewportRef}
        onWheel={onSectionWheel}
      >
        <div
          className="timeline-content-row timeline-section-content-row"
          style={{ transform: `translateY(-${sectionScrollY}px)` }}
        >
          {headerContent}

          <div
            className={`timeline-section-tracks ${clipDragActive ? 'dragging-clip' : ''} ${marqueeActive ? 'marquee-selecting' : ''} ${isExporting ? 'export-locked' : ''}`}
            onMouseDown={onSectionTracksMouseDown}
          >
            <div
              className={`track-lanes-scroll ${sectionPhaseClass} timeline-grid-${gridMode}`}
              style={{
                transform: `translateX(-${alignedScrollX}px)`,
                minWidth: Math.max(duration * zoom + 500, 2000),
                ['--grid-size' as string]: `${gridSize}px`,
                ['--frame-grid-size' as string]: `${frameIntervalPixels}px`,
                ['--timeline-grid-line-width' as string]: `${gridLineWidth}px`,
                ['--frame-grid-strength' as string]: `${Math.round(frameGridOpacity * 100)}%`,
                ['--time-grid-strength' as string]: `${Math.round(timeGridOpacity * 100)}%`,
                ['--time-grid-muted-strength' as string]: `${Math.round(timeGridOpacity * 22)}%`,
              }}
            >
              {lanesContent}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
