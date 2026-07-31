import { useCallback, useMemo } from 'react';
import type { TimelineAuxiliaryLayerProps } from '../components/TimelineAuxiliaryLayer';
import { createSubcompositionFromSelection } from '../../../services/timelineSubcomposition';
import { useTimelineStore } from '../../../stores/timeline';

type TimelineContextMenuProps = TimelineAuxiliaryLayerProps['timelineContextMenuProps'];
type EmptyContextMenuProps = TimelineAuxiliaryLayerProps['emptyContextMenuProps'];
type TrackContextMenuProps = TimelineAuxiliaryLayerProps['trackContextMenuProps'];
type MarkerContextMenuProps = TimelineAuxiliaryLayerProps['markerContextMenuProps'];
type InOutContextMenuProps = TimelineAuxiliaryLayerProps['inOutContextMenuProps'];
type MulticamDialogProps = TimelineAuxiliaryLayerProps['multicamDialogProps'];

interface UseTimelineAuxiliaryLayerPropsArgs
  extends Omit<TimelineContextMenuProps, 'createSubcompositionFromSelection' | 'deleteGapAtTime'> {
  deleteAllGaps: (trackIds?: string[], time?: number) => void;
  deleteGapAtTime: (time: number, trackIds?: string[]) => void;
  emptyContextMenu: EmptyContextMenuProps['menu'];
  handleDeleteInOutPoint: InOutContextMenuProps['onDelete'];
  handleFitToWindow: EmptyContextMenuProps['onFitCompToWindow'];
  inOutContextMenu: InOutContextMenuProps['menu'];
  markerContextMenu: MarkerContextMenuProps['menu'];
  markers: MarkerContextMenuProps['markers'];
  multicamDialogOpen: MulticamDialogProps['open'];
  pickWhipProps: TimelineAuxiliaryLayerProps['pickWhipProps'];
  removeMarker: MarkerContextMenuProps['removeMarker'];
  setEmptyContextMenu: (menu: EmptyContextMenuProps['menu']) => void;
  setInOutContextMenu: (menu: InOutContextMenuProps['menu']) => void;
  setMarkerContextMenu: (menu: MarkerContextMenuProps['menu']) => void;
  setTrackContextMenu: (menu: TrackContextMenuProps['menu']) => void;
  trackContextMenu: TrackContextMenuProps['menu'];
  updateMarker: MarkerContextMenuProps['updateMarker'];
}

export function useTimelineAuxiliaryLayerProps({
  deleteAllGaps,
  emptyContextMenu,
  handleDeleteInOutPoint,
  handleFitToWindow,
  inOutContextMenu,
  markerContextMenu,
  markers,
  multicamDialogOpen,
  pickWhipProps,
  removeMarker,
  setEmptyContextMenu,
  setInOutContextMenu,
  setMarkerContextMenu,
  setTrackContextMenu,
  trackContextMenu,
  updateMarker,
  ...timelineContextMenuProps
}: UseTimelineAuxiliaryLayerPropsArgs): TimelineAuxiliaryLayerProps {
  const addStoryboardClip = useTimelineStore(state => state.addStoryboardClip);
  const addCaptionClip = useTimelineStore(state => state.addCaptionClip);
  const handleCreateSubcompositionFromSelection = useCallback((clipId: string) => {
    void createSubcompositionFromSelection(clipId);
  }, []);

  const handleCloseEmptyContextMenu = useCallback(() => {
    setEmptyContextMenu(null);
  }, [setEmptyContextMenu]);

  const handleEraseGap = useCallback<EmptyContextMenuProps['onEraseGap']>(
    (time, trackId) => {
      timelineContextMenuProps.deleteGapAtTime(time, [trackId]);
    },
    [timelineContextMenuProps]
  );

  const handleEraseLayerGaps = useCallback<EmptyContextMenuProps['onEraseLayerGaps']>(
    (time, trackId) => {
      deleteAllGaps([trackId], time);
    },
    [deleteAllGaps]
  );

  const handleEraseAllGaps = useCallback<EmptyContextMenuProps['onEraseAllGaps']>(() => {
    deleteAllGaps();
  }, [deleteAllGaps]);

  const handleAddStoryboardScene = useCallback<
    NonNullable<EmptyContextMenuProps['onAddStoryboardScene']>
  >((time, trackId) => {
    addStoryboardClip(trackId, time);
  }, [addStoryboardClip]);

  const handleAddCaptionClip = useCallback<
    NonNullable<EmptyContextMenuProps['onAddCaptionClip']>
  >((time, trackId) => {
    void addCaptionClip(trackId, time);
  }, [addCaptionClip]);

  const handleCloseTrackContextMenu = useCallback(() => {
    setTrackContextMenu(null);
  }, [setTrackContextMenu]);

  const handleCloseMarkerContextMenu = useCallback(() => {
    setMarkerContextMenu(null);
  }, [setMarkerContextMenu]);

  const handleCloseInOutContextMenu = useCallback(() => {
    setInOutContextMenu(null);
  }, [setInOutContextMenu]);

  const handleCloseMulticamDialog = useCallback(() => {
    timelineContextMenuProps.setMulticamDialogOpen(false);
  }, [timelineContextMenuProps]);

  return useMemo<TimelineAuxiliaryLayerProps>(() => ({
    emptyContextMenuProps: {
      menu: emptyContextMenu,
      onClose: handleCloseEmptyContextMenu,
      onEraseGap: handleEraseGap,
      onEraseLayerGaps: handleEraseLayerGaps,
      onEraseAllGaps: handleEraseAllGaps,
      onFitCompToWindow: handleFitToWindow,
      onAddStoryboardScene: handleAddStoryboardScene,
      onAddCaptionClip: handleAddCaptionClip,
    },
    inOutContextMenuProps: {
      menu: inOutContextMenu,
      onDelete: handleDeleteInOutPoint,
      onClose: handleCloseInOutContextMenu,
    },
    markerContextMenuProps: {
      menu: markerContextMenu,
      markers,
      updateMarker,
      removeMarker,
      onClose: handleCloseMarkerContextMenu,
    },
    multicamDialogProps: {
      open: multicamDialogOpen,
      onClose: handleCloseMulticamDialog,
      selectedClipIds: timelineContextMenuProps.selectedClipIds,
    },
    pickWhipProps,
    timelineContextMenuProps: {
      ...timelineContextMenuProps,
      createSubcompositionFromSelection: handleCreateSubcompositionFromSelection,
    },
    trackContextMenuProps: {
      menu: trackContextMenu,
      onClose: handleCloseTrackContextMenu,
    },
  }), [
    emptyContextMenu,
    handleCloseEmptyContextMenu,
    handleCloseInOutContextMenu,
    handleCloseMarkerContextMenu,
    handleCloseMulticamDialog,
    handleCloseTrackContextMenu,
    handleCreateSubcompositionFromSelection,
    handleDeleteInOutPoint,
    handleEraseAllGaps,
    handleAddCaptionClip,
    handleAddStoryboardScene,
    handleEraseGap,
    handleEraseLayerGaps,
    handleFitToWindow,
    inOutContextMenu,
    markerContextMenu,
    markers,
    multicamDialogOpen,
    pickWhipProps,
    removeMarker,
    timelineContextMenuProps,
    trackContextMenu,
    updateMarker,
  ]);
}
