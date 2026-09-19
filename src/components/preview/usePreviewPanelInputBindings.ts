import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { useShortcut } from '../../hooks/useShortcut';
import { usePreviewContextMenu } from './usePreviewContextMenu';
import { usePreviewPinchZoom } from './usePreviewPinchZoom';

interface UsePreviewPanelInputBindingsOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  editMode: boolean;
  editCameraOrthoViewActive: boolean;
  effectOrbitActive: boolean;
  handleWheel: (event: WheelEvent) => void;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  isEditableSource: boolean;
  isPreviewShortcutTarget: () => boolean;
  sceneNavEnabled: boolean;
  setEditMode: Dispatch<SetStateAction<boolean>>;
  viewNavigationEnabled: boolean;
}

export function resolvePreviewPinchZoomEnabled(
  viewNavigationEnabled: boolean,
  editMode: boolean,
  effectOrbitActive: boolean,
  sceneNavEnabled: boolean,
): boolean {
  // Camera navigation consumes the synthetic wheel as a camera dolly. It does
  // not reach the later Preview panel zoom branch, while the dock-level pinch
  // fullscreen gesture remains reserved by the Preview container marker.
  return viewNavigationEnabled || sceneNavEnabled || editMode || effectOrbitActive;
}

export function usePreviewPanelInputBindings({
  containerRef,
  editMode,
  editCameraOrthoViewActive,
  effectOrbitActive,
  handleWheel,
  isCanvasInteractionTarget,
  isEditableSource,
  isPreviewShortcutTarget,
  sceneNavEnabled,
  setEditMode,
  viewNavigationEnabled,
}: UsePreviewPanelInputBindingsOptions) {
  usePreviewPinchZoom({
    containerRef,
    enabled: resolvePreviewPinchZoomEnabled(
      viewNavigationEnabled,
      editMode,
      effectOrbitActive,
      sceneNavEnabled,
    ),
    handleWheel,
    isCanvasInteractionTarget,
    // Keep mouse/trackpad zoom and effect-orbit-only pinch unchanged. Both 2D
    // and 3D Preview Edit modes amplify only the synthetic touch pinch delta.
    zoomSpeed: editMode ? 4 : 1,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleNativeWheel = (event: WheelEvent) => {
      handleWheel(event);
    };

    element.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', handleNativeWheel, { capture: true });
  }, [containerRef, handleWheel]);

  const toggleEditModeFromShortcut = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
    setEditMode(prev => !prev);
  }, [containerRef, setEditMode]);

  useShortcut('preview.editMode', toggleEditModeFromShortcut, {
    enabled: isEditableSource,
    shouldHandle: isPreviewShortcutTarget,
  });

  const { handleContextMenu, handleAuxClick } = usePreviewContextMenu({
    editCameraOrthoViewActive,
    isCanvasInteractionTarget,
    sceneNavEnabled,
  });

  const setPanelEditMode = useCallback((value: boolean) => {
    containerRef.current?.focus({ preventScroll: true });
    setEditMode(value);
  }, [containerRef, setEditMode]);

  return {
    handleAuxClick,
    handleContextMenu,
    setPanelEditMode,
  };
}
