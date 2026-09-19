import type { ComponentProps } from 'react';
import { TimelineOverlays } from './TimelineOverlays';

type TimelineOverlaysProps = ComponentProps<typeof TimelineOverlays>;

interface TimelineGlobalOverlayLayersProps {
  clipDrag: TimelineOverlaysProps['clipDrag'];
  clipTrim: TimelineOverlaysProps['clipTrim'];
  duration: number;
  exportProgress: TimelineOverlaysProps['exportProgress'];
  exportRange: TimelineOverlaysProps['exportRange'];
  formatTime: TimelineOverlaysProps['formatTime'];
  getCachedRanges: TimelineOverlaysProps['getCachedRanges'];
  inLineOpacity: number;
  inPoint: number | null;
  isExporting: boolean;
  isRamPreviewing: boolean;
  markerDrag: TimelineOverlaysProps['markerDrag'];
  onMarkerContextMenu: NonNullable<TimelineOverlaysProps['onMarkerContextMenu']>;
  onMarkerPointerDown: TimelineOverlaysProps['onMarkerPointerDown'];
  outLineOpacity: number;
  outPoint: number | null;
  playheadPosition: number;
  ramPreviewProgress: TimelineOverlaysProps['ramPreviewProgress'];
  scrollX: number;
  switchMotionClass: string;
  timeToPixel: TimelineOverlaysProps['timeToPixel'];
  trackHeaderWidth: number;
}

export function TimelineGlobalOverlayLayers({
  clipDrag,
  clipTrim,
  duration,
  exportProgress,
  exportRange,
  formatTime,
  getCachedRanges,
  inLineOpacity,
  inPoint,
  isExporting,
  isRamPreviewing,
  markerDrag,
  onMarkerContextMenu,
  onMarkerPointerDown,
  outLineOpacity,
  outPoint,
  playheadPosition,
  ramPreviewProgress,
  scrollX,
  switchMotionClass,
  timeToPixel,
  trackHeaderWidth,
}: TimelineGlobalOverlayLayersProps) {
  const commonProps = {
    timeToPixel,
    formatTime,
    scrollX,
    inPoint,
    outPoint,
    duration,
    markerDrag,
    onMarkerPointerDown,
    onMarkerContextMenu,
    switchMotionClass,
    clipDrag,
    isRamPreviewing,
    ramPreviewProgress,
    playheadPosition,
    isExporting,
    exportProgress,
    exportRange,
    getCachedRanges,
  };

  return (
    <>
      <div className="timeline-global-overlays" style={{ left: trackHeaderWidth }}>
        <TimelineOverlays
          {...commonProps}
          renderMode="trackOverlays"
          clipTrim={clipTrim}
        />
      </div>

      <div className="timeline-range-marker-overlays" style={{ left: trackHeaderWidth }}>
        <TimelineOverlays
          {...commonProps}
          renderMode="rangeMarkers"
          inLineOpacity={inLineOpacity}
          outLineOpacity={outLineOpacity}
        />
      </div>
    </>
  );
}
