import { useClipDrag } from './useClipDrag';
import { useClipFade } from './useClipFade';
import { useClipTrim } from './useClipTrim';

type ClipDragParams = Parameters<typeof useClipDrag>[0];
type ClipTrimParams = Parameters<typeof useClipTrim>[0];
type ClipFadeParams = Parameters<typeof useClipFade>[0];

interface UseTimelineClipInteractionControllerParams extends Omit<ClipDragParams, 'applyTimelineEditOperation'> {
  addClipEffect: ClipFadeParams['addClipEffect'];
  applyTimelineEditOperation: ClipFadeParams['applyTimelineEditOperation'];
  getClipKeyframes: ClipFadeParams['getClipKeyframes'];
  markers: ClipTrimParams['markers'];
  playheadPosition: ClipTrimParams['playheadPosition'];
  setTimelineToolPreview: ClipTrimParams['setTimelineToolPreview'];
}

export function useTimelineClipInteractionController({
  activeTimelineToolId,
  addClipEffect,
  applyTimelineEditOperation,
  clipMap,
  clips,
  getClipKeyframes,
  getPositionWithResistance,
  getRenderedTrackHeight,
  getSnappedPosition,
  frameRate,
  isExporting,
  markers,
  openCompositionTab,
  pixelToTime,
  playheadPosition,
  scrollX,
  selectClip,
  selectedClipIds,
  setTimelineToolPreview,
  snappingEnabled,
  timelineRef,
  trackLanesRef,
  tracks,
}: UseTimelineClipInteractionControllerParams) {
  const { clipDrag, handleClipMouseDown, handleClipDoubleClick } = useClipDrag({
    trackLanesRef,
    timelineRef,
    clips,
    tracks,
    clipMap,
    selectedClipIds,
    scrollX,
    frameRate,
    snappingEnabled,
    isExporting,
    activeTimelineToolId,
    selectClip,
    applyTimelineEditOperation,
    openCompositionTab,
    pixelToTime,
    getRenderedTrackHeight,
    getSnappedPosition,
    getPositionWithResistance,
  });

  const { clipTrim, handleTrimStart } = useClipTrim({
    clipMap,
    tracks,
    isExporting,
    activeTimelineToolId,
    selectedClipIds,
    snappingEnabled,
    playheadPosition,
    frameRate,
    markers,
    selectClip,
    applyTimelineEditOperation,
    setTimelineToolPreview,
    pixelToTime,
  });

  const { clipFade, handleFadeStart } = useClipFade({
    clipMap,
    tracks,
    isExporting,
    applyTimelineEditOperation,
    getClipKeyframes,
    addClipEffect,
    pixelToTime,
  });

  return {
    clipDrag,
    clipFade,
    clipTrim,
    handleClipDoubleClick,
    handleClipMouseDown,
    handleFadeStart,
    handleTrimStart,
  };
}
