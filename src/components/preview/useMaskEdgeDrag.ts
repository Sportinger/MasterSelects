// Edge segment dragging (move two adjacent vertices together)

import { useRef, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask, TimelineClip } from '../../types';
import { startBatch, endBatch } from '../../stores/historyStore';

export function useMaskEdgeDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const { setMaskDragging } = useTimelineStore();

  const edgeDragState = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startLocalX: number;
    startLocalY: number;
    vertexA: { id: string; x: number; y: number };
    vertexB: { id: string; x: number; y: number };
  }>({ isDragging: false, startX: 0, startY: 0, startLocalX: 0, startLocalY: 0, vertexA: { id: '', x: 0, y: 0 }, vertexB: { id: '', x: 0, y: 0 } });

  const handleEdgeMouseDown = useCallback((e: React.MouseEvent, vertexIdA: string, vertexIdB: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!activeMask || !selectedClip) return;

    const vA = activeMask.vertices.find(v => v.id === vertexIdA);
    const vB = activeMask.vertices.find(v => v.id === vertexIdB);
    if (!vA || !vB) return;

    startBatch('Move mask edge');
    setMaskDragging(true);
    const startLocalPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    edgeDragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startLocalX: startLocalPoint?.x ?? 0,
      startLocalY: startLocalPoint?.y ?? 0,
      vertexA: { id: vA.id, x: vA.x, y: vA.y },
      vertexB: { id: vB.id, x: vB.x, y: vB.y },
    };

    let lastUpdate = 0;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!edgeDragState.current.isDragging || !selectedClip || !activeMask) return;
      const now = performance.now();
      if (now - lastUpdate < 16) return;
      lastUpdate = now;

      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;

      const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
      const dx = localPoint
        ? localPoint.x - edgeDragState.current.startLocalX
        : (moveEvent.clientX - edgeDragState.current.startX) * scaleX / canvasWidth;
      const dy = localPoint
        ? localPoint.y - edgeDragState.current.startLocalY
        : (moveEvent.clientY - edgeDragState.current.startY) * scaleY / canvasHeight;

      const { vertexA, vertexB } = edgeDragState.current;
      const newAx = Math.max(0, Math.min(1, vertexA.x + dx));
      const newAy = Math.max(0, Math.min(1, vertexA.y + dy));
      const newBx = Math.max(0, Math.min(1, vertexB.x + dx));
      const newBy = Math.max(0, Math.min(1, vertexB.y + dy));

      useTimelineStore.getState().updateVertices(
        selectedClip.id,
        activeMask.id,
        [
          { id: vertexA.id, updates: { x: newAx, y: newAy } },
          { id: vertexB.id, updates: { x: newBx, y: newBy } },
        ],
        true
      );
    };

    const handleMouseUp = () => {
      const store = useTimelineStore.getState();
      store.invalidateCache();
      store.setMaskDragging(false);
      endBatch();
      edgeDragState.current = { isDragging: false, startX: 0, startY: 0, startLocalX: 0, startLocalY: 0, vertexA: { id: '', x: 0, y: 0 }, vertexB: { id: '', x: 0, y: 0 } };
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [activeMask, selectedClip, canvasWidth, canvasHeight, setMaskDragging, svgRef, clientToLocalPoint]);

  return { handleEdgeMouseDown };
}
