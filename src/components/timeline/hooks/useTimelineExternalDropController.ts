import { useCallback } from 'react';

import { useExternalDrop } from './useExternalDrop';
import { useTimelineCombinedDragHandlers } from './useTimelineCombinedDragHandlers';
import { useTransitionDrop } from './useTransitionDrop';
import { useTransitionTouchDropBridge } from './useTransitionTouchDropBridge';

type ExternalDropParams = Parameters<typeof useExternalDrop>[0];
type CombinedDragHandlersParams = Parameters<typeof useTimelineCombinedDragHandlers>[0];

interface UseTimelineExternalDropControllerParams extends ExternalDropParams {
  trackMap: CombinedDragHandlersParams['trackMap'];
}

export function useTimelineExternalDropController({
  activeTimelineToolId,
  addCameraClip,
  addClip,
  addCompClip,
  addLightClip,
  addMathSceneClip,
  addMeshClip,
  addMotionShapeClip,
  addSolidClip,
  addSplatEffectorClip,
  addTextClip,
  addTrack,
  clips,
  isExporting,
  pixelToTime,
  prepareTimelinePlacementRange,
  replaceClipSource,
  replaceClipSourceWithComposition,
  scrollX,
  timelineRef,
  trackMap,
  tracks,
  updateClip,
  updateTextProperties,
}: UseTimelineExternalDropControllerParams) {
  const {
    externalDrag,
    dragCounterRef,
    handleTrackDragEnter,
    handleTrackDragOver,
    handleTrackDragLeave,
    handleTrackDrop,
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleContainerDragLeave,
  } = useExternalDrop({
    timelineRef,
    scrollX,
    tracks,
    clips,
    isExporting,
    activeTimelineToolId,
    pixelToTime,
    prepareTimelinePlacementRange,
    replaceClipSource,
    replaceClipSourceWithComposition,
    addTrack,
    addClip,
    addCompClip,
    addLightClip,
    addTextClip,
    updateTextProperties,
    updateClip,
    addSolidClip,
    addMeshClip,
    addCameraClip,
    addSplatEffectorClip,
    addMathSceneClip,
    addMotionShapeClip,
  });

  const {
    activeJunction,
    handleDragOver: handleTransitionDragOver,
    handleDrop: handleTransitionDrop,
    handleDragLeave: handleTransitionDragLeave,
    isTransitionDrag,
  } = useTransitionDrop();

  useTransitionTouchDropBridge({
    isExporting,
    onTransitionDragLeave: handleTransitionDragLeave,
    onTransitionDragOver: handleTransitionDragOver,
    onTransitionDrop: handleTransitionDrop,
    pixelToTime,
    scrollX,
    timelineRef,
    trackMap,
  });

  const {
    handleCombinedDragOver,
    handleCombinedDrop,
    handleCombinedDragLeave,
  } = useTimelineCombinedDragHandlers({
    isExporting,
    trackMap,
    timelineRef,
    scrollX,
    pixelToTime,
    isTransitionDrag,
    onTransitionDragOver: handleTransitionDragOver,
    onTransitionDrop: handleTransitionDrop,
    onTransitionDragLeave: handleTransitionDragLeave,
    onTrackDragOver: handleTrackDragOver,
    onTrackDrop: handleTrackDrop,
    onTrackDragLeave: handleTrackDragLeave,
  });

  const handleNewTrackDragEnter = useCallback(() => {
    dragCounterRef.current++;
  }, [dragCounterRef]);

  return {
    activeJunction,
    externalDrag,
    handleCombinedDragLeave,
    handleCombinedDragOver,
    handleCombinedDrop,
    handleContainerDragLeave,
    handleNewTrackDragEnter,
    handleNewTrackDragOver,
    handleNewTrackDrop,
    handleTrackDragEnter,
    handleTrackDragLeave,
  };
}
