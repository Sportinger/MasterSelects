import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineEditOperation, TimelineEditResult } from '../../../stores/timeline/editOperations/types';
import type { ClipDragState } from '../types';

export interface UseClipDragProps {
  trackLanesRef: React.RefObject<HTMLDivElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipMap: Map<string, TimelineClip>;
  selectedClipIds: Set<string>;
  scrollX: number;
  frameRate: number;
  snappingEnabled: boolean;
  isExporting: boolean;
  activeTimelineToolId: TimelineToolId;
  selectClip: (clipId: string | null, addToSelection?: boolean, setPrimaryOnly?: boolean) => void;
  applyTimelineEditOperation: (
    operation: TimelineEditOperation,
    options: { source: 'ui'; historyLabel?: string },
  ) => TimelineEditResult;
  openCompositionTab: (compositionId: string) => void;
  pixelToTime: (pixel: number) => number;
  getRenderedTrackHeight: (track: TimelineTrack) => number;
  getSnappedPosition: (
    clipId: string,
    rawTime: number,
    trackId: string,
  ) => { startTime: number; snapped: boolean; snapEdgeTime: number };
  getPositionWithResistance: (
    clipId: string,
    rawTime: number,
    trackId: string,
    duration: number,
    zoom?: number,
    excludeClipIds?: string[],
  ) => { startTime: number; forcingOverlap: boolean; noFreeSpace?: boolean };
}

export interface UseClipDragReturn {
  clipDrag: ClipDragState | null;
  clipDragRef: React.MutableRefObject<ClipDragState | null>;
  handleClipMouseDown: (e: React.MouseEvent, clipId: string) => void;
  handleClipDoubleClick: (e: React.MouseEvent, clipId: string) => void;
}
