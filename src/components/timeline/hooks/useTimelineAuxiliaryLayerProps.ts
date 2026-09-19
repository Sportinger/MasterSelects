import { useCallback, useMemo } from 'react';
import type { TimelineAuxiliaryLayerProps } from '../components/TimelineAuxiliaryLayer';
import { trackTimelineEdit } from '../../../services/productAnalytics';
import { createSubcompositionFromSelection } from '../../../services/timelineSubcomposition';
import { useTimelineStore } from '../../../stores/timeline';
import { parseFlockLayerTarget, type TimelineAddLayerTarget } from '../utils/timelineEmptyContextMenu';

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

  const handleAddTimelineLayer = useCallback<
    NonNullable<EmptyContextMenuProps['onAddTimelineLayer']>
  >((time, trackId, target: TimelineAddLayerTarget) => {
    const timeline = useTimelineStore.getState();
    const selectCreatedClip = (clipId: string | null) => {
      if (clipId) useTimelineStore.getState().selectClip(clipId);
    };

    const flockPresetId = parseFlockLayerTarget(target);
    if (flockPresetId) {
      selectCreatedClip(timeline.addFlockClip(trackId, time, { presetId: flockPresetId }));
      return;
    }

    switch (target) {
      case 'text':
        void timeline.addTextClip(trackId, time, undefined, true).then((clipId) => {
          selectCreatedClip(clipId);
          if (clipId) trackTimelineEdit('Add text');
        });
        return;
      case 'solid':
        selectCreatedClip(timeline.addSolidClip(trackId, time, undefined, undefined, true));
        return;
      case 'mesh-cube':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'cube', undefined, true));
        return;
      case 'mesh-sphere':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'sphere', undefined, true));
        return;
      case 'mesh-plane':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'plane', undefined, true));
        return;
      case 'mesh-cylinder':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'cylinder', undefined, true));
        return;
      case 'mesh-torus':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'torus', undefined, true));
        return;
      case 'mesh-cone':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'cone', undefined, true));
        return;
      case 'text-3d':
        selectCreatedClip(timeline.addMeshClip(trackId, time, 'text3d', undefined, true));
        return;
      case 'camera':
        selectCreatedClip(timeline.addCameraClip(trackId, time, undefined, true));
        return;
      case 'light':
        selectCreatedClip(timeline.addLightClip(trackId, time, undefined, true));
        return;
      case 'splat-effector':
        selectCreatedClip(timeline.addSplatEffectorClip(trackId, time, undefined, true));
        return;
      case 'motion-null':
        selectCreatedClip(timeline.addMotionNullClip(trackId, time, 5, 'Motion Null'));
        return;
      case 'motion-adjustment':
        selectCreatedClip(timeline.addMotionAdjustmentClip(trackId, time));
        return;
      case 'motion-rectangle':
        selectCreatedClip(timeline.addMotionShapeClip(trackId, time, { primitive: 'rectangle' }));
        return;
      case 'motion-ellipse':
        selectCreatedClip(timeline.addMotionShapeClip(trackId, time, { primitive: 'ellipse' }));
        return;
      case 'motion-polygon':
        selectCreatedClip(timeline.addMotionShapeClip(trackId, time, { primitive: 'polygon' }));
        return;
      case 'motion-star':
        selectCreatedClip(timeline.addMotionShapeClip(trackId, time, { primitive: 'star' }));
        return;
      case 'math-scene':
        selectCreatedClip(timeline.addMathSceneClip(trackId, time, undefined, true));
    }
  }, []);

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
      onAddTimelineLayer: handleAddTimelineLayer,
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
    handleAddTimelineLayer,
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
