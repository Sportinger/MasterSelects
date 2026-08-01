import { useCallback, useMemo } from 'react';
import { usePickWhipDrag } from './usePickWhipDrag';
import { useTimelineAuxiliaryLayerProps } from './useTimelineAuxiliaryLayerProps';
import { useTimelineAuxiliaryMenuState } from './useTimelineAuxiliaryMenuState';
import { useTimelineRightDragScrub } from './useTimelineRightDragScrub';

type AuxiliaryLayerParams = Parameters<typeof useTimelineAuxiliaryLayerProps>[0];
type AuxiliaryMenuParams = Parameters<typeof useTimelineAuxiliaryMenuState>[0];
type PickWhipParams = Parameters<typeof usePickWhipDrag>[0];
type RightDragScrubParams = Parameters<typeof useTimelineRightDragScrub>[0];

interface UseTimelineAuxiliaryInteractionControllerParams extends Omit<
  AuxiliaryLayerParams,
  | 'contextMenu'
  | 'emptyContextMenu'
  | 'handleDeleteInOutPoint'
  | 'inOutContextMenu'
  | 'markerContextMenu'
  | 'multicamDialogOpen'
  | 'pickWhipProps'
  | 'setContextMenu'
  | 'setEmptyContextMenu'
  | 'setInOutContextMenu'
  | 'setMarkerContextMenu'
  | 'setMulticamDialogOpen'
  | 'setTrackContextMenu'
  | 'trackContextMenu'
> {
  cancelRamPreview: RightDragScrubParams['cancelRamPreview'];
  duration: RightDragScrubParams['duration'];
  handleClipMouseDown: RightDragScrubParams['handleClipMouseDown'];
  isExporting: AuxiliaryMenuParams['isExporting'];
  isPlaying: RightDragScrubParams['isPlaying'];
  isRamPreviewing: RightDragScrubParams['isRamPreviewing'];
  pause: RightDragScrubParams['pause'];
  pixelToTime: RightDragScrubParams['pixelToTime'];
  scrollX: RightDragScrubParams['scrollX'];
  clips: PickWhipParams['clips'];
  setClipParent: PickWhipParams['setClipParent'];
  setDraggingPlayhead: RightDragScrubParams['setDraggingPlayhead'];
  setInPoint: AuxiliaryMenuParams['setInPoint'];
  setOutPoint: AuxiliaryMenuParams['setOutPoint'];
  setPlayheadPosition: RightDragScrubParams['setPlayheadPosition'];
  setTrackParent: PickWhipParams['setTrackParent'];
  tracks: PickWhipParams['tracks'];
  timelineRef: RightDragScrubParams['timelineRef'];
}

export function useTimelineAuxiliaryInteractionController({
  cancelRamPreview,
  duration,
  handleClipMouseDown,
  isExporting,
  isPlaying,
  isRamPreviewing,
  pause,
  pixelToTime,
  scrollX,
  clips,
  selectedClipIds,
  selectClip,
  setClipParent,
  setDraggingPlayhead,
  setInPoint,
  setOutPoint,
  setPlayheadPosition,
  setTrackParent,
  tracks,
  timelineRef,
  ...auxiliaryLayerParams
}: UseTimelineAuxiliaryInteractionControllerParams) {
  const {
    contextMenu,
    setContextMenu,
    emptyContextMenu,
    setEmptyContextMenu,
    trackContextMenu,
    setTrackContextMenu,
    markerContextMenu,
    setMarkerContextMenu,
    inOutContextMenu,
    setInOutContextMenu,
    multicamDialogOpen,
    setMulticamDialogOpen,
    openClipContextMenu,
    closeTimelineContextMenus,
    handleInOutMarkerContextMenu,
    handleTimelineMarkerContextMenu,
    handleDeleteInOutPoint,
  } = useTimelineAuxiliaryMenuState({
    selectedClipIds,
    selectClip,
    isExporting,
    setInPoint,
    setOutPoint,
  });

  const {
    handleEmptyTimelineMouseDown,
    handleEmptyTimelineContextMenu,
    handleClipContextMenu,
    handleTimelineClipMouseDown,
  } = useTimelineRightDragScrub({
    timelineRef,
    scrollX,
    duration,
    isExporting,
    isPlaying,
    isRamPreviewing,
    pixelToTime,
    pause,
    cancelRamPreview,
    setDraggingPlayhead,
    setPlayheadPosition,
    closeTimelineContextMenus,
    setEmptyContextMenu,
    openClipContextMenu,
    handleClipMouseDown,
  });

  const {
    pickWhipDrag,
    handlePickWhipDragStart,
    handlePickWhipDragEnd,
    trackPickWhipDrag,
    handleTrackPickWhipDragStart,
    handleTrackPickWhipDragEnd,
  } = usePickWhipDrag({ clips, tracks, setClipParent, setTrackParent });

  const clearClipParent = useCallback((clipId: string) => {
    setClipParent(clipId, null);
  }, [setClipParent]);
  const pickWhipContextDrag = useMemo(() => {
    const sourceClipId = pickWhipDrag?.sourceClipId;
    if (!sourceClipId) return null;
    return {
      sourceClipId,
      targetClipId: pickWhipDrag?.targetClipId ?? null,
      status: pickWhipDrag?.status ?? 'idle',
      diagnostic: pickWhipDrag?.diagnostic ?? 'Drop onto an unlocked 2D video clip.',
    } as const;
  }, [
    pickWhipDrag?.diagnostic,
    pickWhipDrag?.sourceClipId,
    pickWhipDrag?.status,
    pickWhipDrag?.targetClipId,
  ]);
  const pickWhipContextValue = useMemo(() => ({
    drag: pickWhipContextDrag,
    startDrag: handlePickWhipDragStart,
    cancelDrag: handlePickWhipDragEnd,
    clearParent: clearClipParent,
  }), [
    clearClipParent,
    handlePickWhipDragEnd,
    handlePickWhipDragStart,
    pickWhipContextDrag,
  ]);

  const auxiliaryLayerProps = useTimelineAuxiliaryLayerProps({
    ...auxiliaryLayerParams,
    contextMenu,
    setContextMenu,
    emptyContextMenu,
    setEmptyContextMenu,
    trackContextMenu,
    setTrackContextMenu,
    markerContextMenu,
    setMarkerContextMenu,
    inOutContextMenu,
    setInOutContextMenu,
    multicamDialogOpen,
    setMulticamDialogOpen,
    handleDeleteInOutPoint,
    pickWhipProps: { pickWhipDrag, trackPickWhipDrag },
    selectedClipIds,
    selectClip,
  });

  return {
    auxiliaryLayerProps,
    contextMenu,
    setContextMenu,
    setEmptyContextMenu,
    setInOutContextMenu,
    setMarkerContextMenu,
    setTrackContextMenu,
    handleClipContextMenu,
    handleEmptyTimelineContextMenu,
    handleEmptyTimelineMouseDown,
    handleInOutMarkerContextMenu,
    handleTimelineClipMouseDown,
    handleTimelineMarkerContextMenu,
    pickWhipContextValue,
    handleTrackPickWhipDragEnd,
    handleTrackPickWhipDragStart,
  };
}
