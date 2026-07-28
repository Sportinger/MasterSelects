import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { useShortcut } from '../../hooks/useShortcut';
import { usePreviewContextMenu } from './usePreviewContextMenu';

interface UsePreviewPanelInputBindingsOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  editCameraOrthoViewActive: boolean;
  handleWheel: (event: WheelEvent) => void;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  isEditableSource: boolean;
  isPreviewShortcutTarget: () => boolean;
  sceneNavEnabled: boolean;
  setEditMode: Dispatch<SetStateAction<boolean>>;
}

export function usePreviewPanelInputBindings({
  containerRef,
  editCameraOrthoViewActive,
  handleWheel,
  isCanvasInteractionTarget,
  isEditableSource,
  isPreviewShortcutTarget,
  sceneNavEnabled,
  setEditMode,
}: UsePreviewPanelInputBindingsOptions) {
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
