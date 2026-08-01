// Whole-mask dragging with a transient live preview and one durable commit.

import { useCallback, useEffect, useId, useRef } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask } from '../../types/masks';
import type { TimelineClip } from '../../types/timeline';
import { startBatch } from '../../stores/historyStore';
import { commitWholeMaskDrag } from './maskPathDragPreview';

interface MaskDragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  startLocalX: number;
  startLocalY: number;
  startPositionX: number;
  startPositionY: number;
  latestPositionX: number;
  latestPositionY: number;
  didDrag: boolean;
}

function createIdleMaskDragState(): MaskDragState {
  return {
    isDragging: false,
    startX: 0,
    startY: 0,
    startLocalX: 0,
    startLocalY: 0,
    startPositionX: 0,
    startPositionY: 0,
    latestPositionX: 0,
    latestPositionY: 0,
    didDrag: false,
  };
}

export function useMaskDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const { setMaskDragging } = useTimelineStore();
  const previewOwnerId = useId();
  const maskDragState = useRef<MaskDragState>(createIdleMaskDragState());
  const activeDragCleanup = useRef<(() => void) | null>(null);

  const clearOwnedMaskPreview = useCallback(() => {
    useTimelineStore.setState((state) => state.maskEditPreview?.ownerId === previewOwnerId
      ? { maskEditPreview: null }
      : {});
  }, [previewOwnerId]);

  useEffect(() => () => {
    activeDragCleanup.current?.();
    activeDragCleanup.current = null;
    if (maskDragState.current.isDragging) {
      clearOwnedMaskPreview();
      useTimelineStore.getState().setMaskDragging(false);
      maskDragState.current = createIdleMaskDragState();
    }
  }, [clearOwnedMaskPreview]);

  const handleMaskDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();
    if (!activeMask || !selectedClip || !activeMask.visible) return;

    activeDragCleanup.current?.();
    clearOwnedMaskPreview();
    const startLocalPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    const startPositionX = activeMask.position?.x ?? 0;
    const startPositionY = activeMask.position?.y ?? 0;
    maskDragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startLocalX: startLocalPoint?.x ?? 0,
      startLocalY: startLocalPoint?.y ?? 0,
      startPositionX,
      startPositionY,
      latestPositionX: startPositionX,
      latestPositionY: startPositionY,
      didDrag: false,
    };
    setMaskDragging(true);

    let latestMoveEvent: MouseEvent | null = null;
    let moveFrame: number | null = null;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!maskDragState.current.isDragging) return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
      const normalizedDx = localPoint
        ? localPoint.x - maskDragState.current.startLocalX
        : ((moveEvent.clientX - maskDragState.current.startX) * scaleX) / canvasWidth;
      const normalizedDy = localPoint
        ? localPoint.y - maskDragState.current.startLocalY
        : ((moveEvent.clientY - maskDragState.current.startY) * scaleY) / canvasHeight;
      const position = {
        x: maskDragState.current.startPositionX + normalizedDx,
        y: maskDragState.current.startPositionY + normalizedDy,
      };

      maskDragState.current.latestPositionX = position.x;
      maskDragState.current.latestPositionY = position.y;
      maskDragState.current.didDrag =
        maskDragState.current.didDrag ||
        Math.hypot(
          moveEvent.clientX - maskDragState.current.startX,
          moveEvent.clientY - maskDragState.current.startY,
        ) > 2;
      useTimelineStore.setState({
        maskEditPreview: {
          ownerId: previewOwnerId,
          clipId: selectedClip.id,
          mask: {
            ...activeMask,
            position,
          },
        },
      });
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestMoveEvent = moveEvent;
      if (moveFrame !== null) return;
      moveFrame = window.requestAnimationFrame(() => {
        moveFrame = null;
        if (latestMoveEvent) applyMouseMove(latestMoveEvent);
      });
    };

    const cleanup = () => {
      if (moveFrame !== null) {
        window.cancelAnimationFrame(moveFrame);
        moveFrame = null;
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      if (activeDragCleanup.current === cleanup) activeDragCleanup.current = null;
    };

    const handleMouseUp = () => {
      if (latestMoveEvent) {
        applyMouseMove(latestMoveEvent);
        latestMoveEvent = null;
      }
      const finalState = maskDragState.current;
      if (finalState.didDrag) {
        const batch = startBatch('Move mask');
        commitWholeMaskDrag(
          useTimelineStore.getState(),
          selectedClip.id,
          activeMask,
          {
            x: finalState.startPositionX,
            y: finalState.startPositionY,
          },
          {
            x: finalState.latestPositionX,
            y: finalState.latestPositionY,
          },
          batch,
        );
      }

      clearOwnedMaskPreview();
      setMaskDragging(false);
      maskDragState.current = createIdleMaskDragState();
      cleanup();
    };

    activeDragCleanup.current = cleanup;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [
    activeMask,
    canvasHeight,
    canvasWidth,
    clearOwnedMaskPreview,
    clientToLocalPoint,
    previewOwnerId,
    selectedClip,
    setMaskDragging,
    svgRef,
  ]);

  return { handleMaskDragStart };
}
