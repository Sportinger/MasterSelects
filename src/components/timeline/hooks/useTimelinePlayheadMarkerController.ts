import { useMarkerDrag } from './useMarkerDrag';
import { usePlayheadDrag } from './usePlayheadDrag';
import { useTimelineCompositionVideoBakeRulerDrag } from './useTimelineCompositionVideoBakeRulerDrag';
import type { TimelineToolId, TimelineTrackFocusMode } from '../../../stores/timeline/types';

type MarkerDragParams = Parameters<typeof useMarkerDrag>[0];
type PlayheadDragParams = Parameters<typeof usePlayheadDrag>[0];
type CompositionVideoBakeRulerDragParams = Parameters<typeof useTimelineCompositionVideoBakeRulerDrag>[0];

interface UseTimelinePlayheadMarkerControllerParams extends PlayheadDragParams, Pick<
  MarkerDragParams,
  | 'addMarker'
  | 'getSnapTargetTimes'
  | 'markers'
  | 'moveMarker'
  | 'playheadPosition'
  | 'snappingEnabled'
  | 'timelineBodyRef'
> {
  activeTimelineToolId: TimelineToolId;
  addCompositionVideoBakeRegion: CompositionVideoBakeRulerDragParams['addCompositionVideoBakeRegion'];
  clearVideoBakeRegionSelection: CompositionVideoBakeRulerDragParams['clearVideoBakeRegionSelection'];
  setVideoBakeRegionSelection: CompositionVideoBakeRulerDragParams['setVideoBakeRegionSelection'];
  trackFocusMode: TimelineTrackFocusMode;
  videoBakeRegionSelection: CompositionVideoBakeRulerDragParams['videoBakeRegionSelection'];
}

export function useTimelinePlayheadMarkerController({
  activeTimelineToolId,
  addCompositionVideoBakeRegion,
  addMarker,
  cancelRamPreview,
  clearVideoBakeRegionSelection,
  duration,
  getSnapTargetTimes,
  inPoint,
  isExporting,
  isPlaying,
  isRamPreviewing,
  markers,
  moveMarker,
  outPoint,
  pause,
  pixelToTime,
  playheadPosition,
  scrollX,
  setDraggingPlayhead,
  setInPoint,
  setOutPoint,
  setPlayheadPosition,
  setVideoBakeRegionSelection,
  snappingEnabled,
  timelineBodyRef,
  timelineRef,
  trackFocusMode,
  videoBakeRegionSelection,
}: UseTimelinePlayheadMarkerControllerParams) {
  const {
    markerDrag,
    handleRulerMouseDown,
    handlePlayheadMouseDown,
    handleMarkerPointerDown,
  } = usePlayheadDrag({
    timelineRef,
    scrollX,
    duration,
    inPoint,
    outPoint,
    isRamPreviewing,
    isPlaying,
    isExporting,
    setPlayheadPosition,
    setDraggingPlayhead,
    setInPoint,
    setOutPoint,
    cancelRamPreview,
    pause,
    pixelToTime,
  });

  const canMarkCompositionVideoBakeRegion =
    trackFocusMode === 'video' &&
    activeTimelineToolId === 'select' &&
    !isExporting;

  const { handleTimelineRulerMouseDown } = useTimelineCompositionVideoBakeRulerDrag({
    timelineRef,
    scrollX,
    duration,
    canMarkCompositionVideoBakeRegion,
    videoBakeRegionSelection,
    pixelToTime,
    onRulerMouseDown: handleRulerMouseDown,
    setVideoBakeRegionSelection,
    clearVideoBakeRegionSelection,
    addCompositionVideoBakeRegion,
  });

  const {
    timelineMarkerDrag,
    markerCreateDrag,
    handleTimelineMarkerPointerDown,
  } = useMarkerDrag({
    timelineRef,
    timelineBodyRef,
    markers,
    scrollX,
    snappingEnabled,
    duration,
    playheadPosition,
    inPoint,
    outPoint,
    pixelToTime,
    getSnapTargetTimes,
    moveMarker,
    addMarker,
  });

  return {
    handleMarkerPointerDown,
    handlePlayheadMouseDown,
    handleTimelineMarkerPointerDown,
    handleTimelineRulerMouseDown,
    markerCreateDrag,
    markerDrag,
    timelineMarkerDrag,
  };
}
