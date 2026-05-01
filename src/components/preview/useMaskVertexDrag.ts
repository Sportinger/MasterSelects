// Mask vertex/handle dragging with document-level listeners

import { useRef, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask, MaskVertex, TimelineClip } from '../../types';
import { startBatch, endBatch } from '../../stores/historyStore';
import { inferMaskVertexHandleMode } from '../../utils/maskVertexHandles';

function constrainHandleDelta(dx: number, dy: number, shiftKey: boolean): { x: number; y: number } {
  if (!shiftKey) return { x: dx, y: dy };

  const length = Math.hypot(dx, dy);
  if (length < 0.000001) return { x: 0, y: 0 };

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: Math.cos(snappedAngle) * length,
    y: Math.sin(snappedAngle) * length,
  };
}

export function useMaskVertexDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
  onDragEnd?: (didDrag: boolean) => void,
) {
  const {
    selectVertex,
    updateVertex,
    setMaskDragging,
  } = useTimelineStore();

  const dragState = useRef<{
    vertexId: string | null;
    handleType: 'vertex' | 'handleIn' | 'handleOut' | null;
    startX: number;
    startY: number;
    startLocalX: number;
    startLocalY: number;
    startVertexX: number;
    startVertexY: number;
    startHandleX: number;
    startHandleY: number;
    lastShiftState: boolean;
    shiftStartX: number;
    shiftStartVertexX: number;
    shiftStartVertexY: number;
    startHandleInX: number;
    startHandleInY: number;
    startHandleOutX: number;
    startHandleOutY: number;
    startVertices: Array<{ id: string; x: number; y: number }>;
    didDrag: boolean;
  }>({
    vertexId: null,
    handleType: null,
    startX: 0,
    startY: 0,
    startLocalX: 0,
    startLocalY: 0,
    startVertexX: 0,
    startVertexY: 0,
    startHandleX: 0,
    startHandleY: 0,
    lastShiftState: false,
    shiftStartX: 0,
    shiftStartVertexX: 0,
    shiftStartVertexY: 0,
    startHandleInX: 0,
    startHandleInY: 0,
    startHandleOutX: 0,
    startHandleOutY: 0,
    startVertices: [],
    didDrag: false,
  });

  const handleVertexMouseDown = useCallback((
    e: React.MouseEvent,
    vertexId: string,
    handleType: 'vertex' | 'handleIn' | 'handleOut'
  ) => {
    e.stopPropagation();
    e.preventDefault();

    if (!activeMask || !selectedClip) return;

    const vertex = activeMask.vertices.find(v => v.id === vertexId);
    if (!vertex) return;

    const currentSelection = useTimelineStore.getState().selectedVertexIds;
    const addToSelection = handleType === 'vertex' && (e.ctrlKey || e.metaKey);
    const keepMultiSelection = handleType === 'vertex' && currentSelection.has(vertexId) && currentSelection.size > 1 && !addToSelection;

    if (addToSelection && currentSelection.has(vertexId)) {
      selectVertex(vertexId, true);
      return;
    }

    let selectedIds: string[];
    if (keepMultiSelection) {
      selectedIds = Array.from(currentSelection);
    } else if (addToSelection) {
      selectedIds = Array.from(new Set([...currentSelection, vertexId]));
      selectVertex(vertexId, addToSelection);
    } else {
      selectedIds = [vertexId];
      selectVertex(vertexId, false);
    }

    const startVertices = activeMask.vertices
      .filter(v => selectedIds.includes(v.id))
      .map(v => ({ id: v.id, x: v.x, y: v.y }));

    startBatch(handleType === 'vertex' ? 'Move mask vertices' : 'Adjust mask bezier handle');
    setMaskDragging(true);
    const startLocalPoint = clientToLocalPoint?.(e.clientX, e.clientY);

    dragState.current = {
      vertexId,
      handleType,
      startX: e.clientX,
      startY: e.clientY,
      startLocalX: startLocalPoint?.x ?? vertex.x,
      startLocalY: startLocalPoint?.y ?? vertex.y,
      startVertexX: vertex.x,
      startVertexY: vertex.y,
      startHandleX: handleType === 'handleIn' ? vertex.handleIn.x : vertex.handleOut.x,
      startHandleY: handleType === 'handleIn' ? vertex.handleIn.y : vertex.handleOut.y,
      lastShiftState: false,
      shiftStartX: e.clientX,
      shiftStartVertexX: vertex.x,
      shiftStartVertexY: vertex.y,
      startHandleInX: vertex.handleIn.x,
      startHandleInY: vertex.handleIn.y,
      startHandleOutX: vertex.handleOut.x,
      startHandleOutY: vertex.handleOut.y,
      startVertices,
      didDrag: false,
    };

    let latestMoveEvent: MouseEvent | null = null;
    let moveFrame: number | null = null;

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!dragState.current.vertexId || !dragState.current.handleType) return;
      if (!selectedClip || !activeMask) return;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;

      const isShiftPressed = moveEvent.shiftKey;
      if (Math.hypot(moveEvent.clientX - dragState.current.startX, moveEvent.clientY - dragState.current.startY) > 2) {
        dragState.current.didDrag = true;
      }

      if (isShiftPressed && !dragState.current.lastShiftState) {
        dragState.current.shiftStartX = moveEvent.clientX;
        const { clips } = useTimelineStore.getState();
        const clip = clips.find(c => c.id === selectedClip.id);
        const mask = clip?.masks?.find(m => m.id === activeMask.id);
        const currentVertex = mask?.vertices.find(v => v.id === dragState.current.vertexId);
        if (currentVertex) {
          dragState.current.shiftStartVertexX = currentVertex.x;
          dragState.current.shiftStartVertexY = currentVertex.y;
        }
      }
      dragState.current.lastShiftState = isShiftPressed;

      if (dragState.current.handleType === 'vertex') {
        if (isShiftPressed) {
          const shiftDx = (moveEvent.clientX - dragState.current.shiftStartX) * scaleX;
          const normalizedShiftDx = shiftDx / canvasWidth;
          const scaleFactor = 1 + normalizedShiftDx * 5;

          updateVertex(selectedClip.id, activeMask.id, dragState.current.vertexId, {
            x: dragState.current.shiftStartVertexX,
            y: dragState.current.shiftStartVertexY,
            handleIn: {
              x: dragState.current.startHandleInX * scaleFactor,
              y: dragState.current.startHandleInY * scaleFactor,
            },
            handleOut: {
              x: dragState.current.startHandleOutX * scaleFactor,
              y: dragState.current.startHandleOutY * scaleFactor,
            },
          }, true);
        } else {
          const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
          const normalizedDx = localPoint
            ? localPoint.x - dragState.current.startLocalX
            : ((moveEvent.clientX - dragState.current.startX) * scaleX) / canvasWidth;
          const normalizedDy = localPoint
            ? localPoint.y - dragState.current.startLocalY
            : ((moveEvent.clientY - dragState.current.startY) * scaleY) / canvasHeight;

          const vertexUpdates = dragState.current.startVertices.map(startVertex => ({
            id: startVertex.id,
            updates: {
              x: Math.max(0, Math.min(1, startVertex.x + normalizedDx)),
              y: Math.max(0, Math.min(1, startVertex.y + normalizedDy)),
            },
          }));
          useTimelineStore.getState().updateVertices(selectedClip.id, activeMask.id, vertexUpdates, true);
        }
      } else {
        const handleKey = dragState.current.handleType;
        const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
        const rawHandle = localPoint
          ? {
              x: localPoint.x - dragState.current.startVertexX,
              y: localPoint.y - dragState.current.startVertexY,
            }
          : {
              x: dragState.current.startHandleX + ((moveEvent.clientX - dragState.current.startX) * scaleX) / canvasWidth,
              y: dragState.current.startHandleY + ((moveEvent.clientY - dragState.current.startY) * scaleY) / canvasHeight,
            };
        const nextHandle = constrainHandleDelta(
          rawHandle.x,
          rawHandle.y,
          moveEvent.shiftKey,
        );
        const currentVertex = useTimelineStore.getState()
          .clips.find(c => c.id === selectedClip.id)
          ?.masks?.find(m => m.id === activeMask.id)
          ?.vertices.find(v => v.id === dragState.current.vertexId);
        const currentMode = currentVertex ? inferMaskVertexHandleMode(currentVertex) : 'mirrored';
        const nextMode = moveEvent.altKey || currentMode === 'split' ? 'split' : 'mirrored';
        const updates = {
          [handleKey]: nextHandle,
          handleMode: nextMode,
        } as Partial<MaskVertex>;

        if (nextMode === 'mirrored') {
          const oppositeHandleKey = handleKey === 'handleIn' ? 'handleOut' : 'handleIn';
          updates[oppositeHandleKey] = {
            x: -nextHandle.x,
            y: -nextHandle.y,
          };
        }

        updateVertex(selectedClip.id, activeMask.id, dragState.current.vertexId, {
          ...updates,
        }, true);
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestMoveEvent = moveEvent;
      if (moveFrame !== null) return;

      moveFrame = window.requestAnimationFrame(() => {
        moveFrame = null;
        if (latestMoveEvent) {
          applyMouseMove(latestMoveEvent);
        }
      });
    };

    const handleMouseUp = () => {
      if (moveFrame !== null) {
        window.cancelAnimationFrame(moveFrame);
        moveFrame = null;
      }
      if (latestMoveEvent) {
        applyMouseMove(latestMoveEvent);
        latestMoveEvent = null;
      }
      const didDrag = dragState.current.didDrag;
      useTimelineStore.getState().invalidateCache();
      setMaskDragging(false);
      endBatch();
      dragState.current = {
        vertexId: null,
        handleType: null,
        startX: 0,
        startY: 0,
        startLocalX: 0,
        startLocalY: 0,
        startVertexX: 0,
        startVertexY: 0,
        startHandleX: 0,
        startHandleY: 0,
        lastShiftState: false,
        shiftStartX: 0,
        shiftStartVertexX: 0,
        shiftStartVertexY: 0,
        startHandleInX: 0,
        startHandleInY: 0,
        startHandleOutX: 0,
        startHandleOutY: 0,
        startVertices: [],
        didDrag: false,
      };
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      onDragEnd?.(didDrag);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [activeMask, selectedClip, selectVertex, canvasWidth, canvasHeight, setMaskDragging, updateVertex, svgRef, clientToLocalPoint, onDragEnd]);

  return { handleVertexMouseDown };
}
