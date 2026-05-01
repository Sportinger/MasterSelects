// Whole-mask dragging (move all vertices together)

import { useRef, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask, TimelineClip } from '../../types';
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
    startVertices: Array<{ id: string; x: number; y: number }>;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startLocalX: 0,
    startLocalY: 0,
    startVertices: [],
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
      startVertices: activeMask.vertices.map(v => ({ id: v.id, x: v.x, y: v.y })),
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

      useTimelineStore.getState().updateVertices(
        selectedClip.id,
        activeMask.id,
        maskDragState.current.startVertices.map(startVertex => ({
          id: startVertex.id,
          updates: {
            x: Math.max(0, Math.min(1, startVertex.x + normalizedDx)),
            y: Math.max(0, Math.min(1, startVertex.y + normalizedDy)),
          },
        })),
        true
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
        startVertices: [],
      };
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [activeMask, selectedClip, canvasWidth, canvasHeight, setMaskDragging, svgRef, clientToLocalPoint]);

  return { handleMaskDragStart };
}
