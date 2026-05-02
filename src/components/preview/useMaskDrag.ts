// Whole-mask dragging (move the mask transform so X/Y fields stay live)

import { useRef, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { createMaskNumericProperty, type ClipMask, type TimelineClip } from '../../types';
import { startBatch, endBatch } from '../../stores/historyStore';

export function useMaskDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const { setMaskDragging } = useTimelineStore();

  const maskDragState = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startLocalX: number;
    startLocalY: number;
    startPositionX: number;
    startPositionY: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startLocalX: 0,
    startLocalY: 0,
    startPositionX: 0,
    startPositionY: 0,
  });

  const handleMaskDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!activeMask || !selectedClip || !activeMask.visible) return;

    startBatch('Move mask');
    const startLocalPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    maskDragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startLocalX: startLocalPoint?.x ?? 0,
      startLocalY: startLocalPoint?.y ?? 0,
      startPositionX: activeMask.position?.x ?? 0,
      startPositionY: activeMask.position?.y ?? 0,
    };

    setMaskDragging(true);

    let lastMaskUpdate = 0;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!maskDragState.current.isDragging) return;
      if (!selectedClip || !activeMask) return;

      const now = performance.now();
      if (now - lastMaskUpdate < 16) return;
      lastMaskUpdate = now;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;

      const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
      const normalizedDx = localPoint
        ? localPoint.x - maskDragState.current.startLocalX
        : ((moveEvent.clientX - maskDragState.current.startX) * scaleX) / canvasWidth;
      const normalizedDy = localPoint
        ? localPoint.y - maskDragState.current.startLocalY
        : ((moveEvent.clientY - maskDragState.current.startY) * scaleY) / canvasHeight;

      const store = useTimelineStore.getState();
      store.setPropertyValue(
        selectedClip.id,
        createMaskNumericProperty(activeMask.id, 'position.x'),
        maskDragState.current.startPositionX + normalizedDx,
      );
      store.setPropertyValue(
        selectedClip.id,
        createMaskNumericProperty(activeMask.id, 'position.y'),
        maskDragState.current.startPositionY + normalizedDy,
      );
    };

    const handleMouseUp = () => {
      const store = useTimelineStore.getState();
      store.invalidateCache();
      store.setMaskDragging(false);
      endBatch();
      maskDragState.current = {
        isDragging: false,
        startX: 0,
        startY: 0,
        startLocalX: 0,
        startLocalY: 0,
        startPositionX: 0,
        startPositionY: 0,
      };
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [activeMask, selectedClip, canvasWidth, canvasHeight, setMaskDragging, svgRef, clientToLocalPoint]);

  return { handleMaskDragStart };
}
