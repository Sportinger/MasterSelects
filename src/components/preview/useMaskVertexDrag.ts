// Mask vertex/handle dragging with document-level listeners

import { useCallback, useId, useRef } from 'react';
import { startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask, MaskVertex } from '../../types/masks';
import type { TimelineClip } from '../../types/timeline';
import { inferMaskVertexHandleMode } from '../../utils/maskVertexHandles';
import { getMaskGeometryCenter } from '../../utils/maskTransform';
import {
  applyMaskVertexUpdates,
  clearMaskPathDragPreview,
  commitMaskPathDrag,
  publishMaskPathDragPreview,
  type MaskPathDragBatch,
  type MaskVertexUpdate,
} from './maskPathDragPreview';

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

function lineIntersection(
  pointA: { x: number; y: number },
  directionA: { x: number; y: number },
  pointB: { x: number; y: number },
  directionB: { x: number; y: number },
): { x: number; y: number } | null {
  const determinant = directionA.x * directionB.y - directionA.y * directionB.x;
  if (Math.abs(determinant) < 0.000001) return null;

  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  const t = (dx * directionB.y - dy * directionB.x) / determinant;
  return {
    x: pointA.x + directionA.x * t,
    y: pointA.y + directionA.y * t,
  };
}

const ELLIPSE_GEOMETRY_EPSILON = 0.0001;

function vectorLength(point: { x: number; y: number }): number {
  return Math.hypot(point.x, point.y);
}

function isStraightCornerQuad(mask: ClipMask): boolean {
  return mask.vertices.every(vertex => (
    vectorLength(vertex.handleIn) < ELLIPSE_GEOMETRY_EPSILON
    && vectorLength(vertex.handleOut) < ELLIPSE_GEOMETRY_EPSILON
  ));
}

function getEllipseHandleScale(mask: ClipMask): number | null {
  if (!mask.closed || mask.vertices.length !== 4) return null;

  const [first, second, third, fourth] = mask.vertices;
  if (!first || !second || !third || !fourth) return null;

  const centerA = {
    x: (first.x + third.x) / 2,
    y: (first.y + third.y) / 2,
  };
  const centerB = {
    x: (second.x + fourth.x) / 2,
    y: (second.y + fourth.y) / 2,
  };
  const geometryScale = Math.max(
    vectorLength({ x: first.x - third.x, y: first.y - third.y }),
    vectorLength({ x: second.x - fourth.x, y: second.y - fourth.y }),
    1,
  );
  if (vectorLength({ x: centerA.x - centerB.x, y: centerA.y - centerB.y }) > ELLIPSE_GEOMETRY_EPSILON * geometryScale) {
    return null;
  }

  const center = {
    x: (centerA.x + centerB.x) / 2,
    y: (centerA.y + centerB.y) / 2,
  };
  const radialPoints = mask.vertices.map(vertex => ({
    x: vertex.x - center.x,
    y: vertex.y - center.y,
  }));
  const firstAxis = radialPoints[0];
  const secondAxis = radialPoints[1];
  if (!firstAxis || !secondAxis) return null;
  if (Math.abs(firstAxis.x * secondAxis.y - firstAxis.y * secondAxis.x) < ELLIPSE_GEOMETRY_EPSILON) {
    return null;
  }

  const handleScales: number[] = [];
  for (let index = 0; index < mask.vertices.length; index += 1) {
    const vertex = mask.vertices[index];
    const previousRadial = radialPoints[(index + 3) % 4];
    const nextRadial = radialPoints[(index + 1) % 4];
    if (!vertex || !previousRadial || !nextRadial) return null;

    const mirrorError = vectorLength({
      x: vertex.handleIn.x + vertex.handleOut.x,
      y: vertex.handleIn.y + vertex.handleOut.y,
    });
    const handleLength = Math.max(vectorLength(vertex.handleIn), vectorLength(vertex.handleOut));
    if (handleLength < ELLIPSE_GEOMETRY_EPSILON || mirrorError > handleLength * 0.02) return null;

    for (const [handle, radial] of [
      [vertex.handleIn, previousRadial],
      [vertex.handleOut, nextRadial],
    ] as const) {
      const radialLengthSquared = radial.x * radial.x + radial.y * radial.y;
      if (radialLengthSquared < ELLIPSE_GEOMETRY_EPSILON ** 2) return null;
      const scale = (handle.x * radial.x + handle.y * radial.y) / radialLengthSquared;
      if (scale <= 0.05 || scale >= 2) return null;
      const residual = vectorLength({
        x: handle.x - radial.x * scale,
        y: handle.y - radial.y * scale,
      });
      if (residual > Math.max(handleLength, ELLIPSE_GEOMETRY_EPSILON) * 0.02) return null;
      handleScales.push(scale);
    }
  }

  const averageScale = handleScales.reduce((sum, scale) => sum + scale, 0) / handleScales.length;
  if (handleScales.some(scale => Math.abs(scale - averageScale) > 0.02)) return null;
  return averageScale;
}

export function buildEllipseResizeVertexUpdates(
  mask: ClipMask,
  vertexId: string,
  target: { x: number; y: number },
): Array<{ id: string; updates: Partial<MaskVertex> }> | null {
  const handleScale = getEllipseHandleScale(mask);
  if (handleScale === null) return null;

  const index = mask.vertices.findIndex(vertex => vertex.id === vertexId);
  if (index < 0) return null;
  const oppositeIndex = (index + 2) % 4;
  const opposite = mask.vertices[oppositeIndex];
  const first = mask.vertices[0];
  const third = mask.vertices[2];
  if (!opposite || !first || !third) return null;

  const previousCenter = {
    x: (first.x + third.x) / 2,
    y: (first.y + third.y) / 2,
  };
  const nextCenter = {
    x: (target.x + opposite.x) / 2,
    y: (target.y + opposite.y) / 2,
  };
  const radialPoints = mask.vertices.map(vertex => ({
    x: vertex.x - previousCenter.x,
    y: vertex.y - previousCenter.y,
  }));
  const resizedAxis = {
    x: target.x - nextCenter.x,
    y: target.y - nextCenter.y,
  };
  radialPoints[index] = resizedAxis;
  radialPoints[oppositeIndex] = { x: -resizedAxis.x, y: -resizedAxis.y };

  const nextVertices = mask.vertices.map((vertex, vertexIndex) => ({
    ...vertex,
    x: nextCenter.x + radialPoints[vertexIndex]!.x,
    y: nextCenter.y + radialPoints[vertexIndex]!.y,
  }));

  return nextVertices.map((vertex, vertexIndex) => {
    const previousRadial = radialPoints[(vertexIndex + 3) % 4]!;
    const nextRadial = radialPoints[(vertexIndex + 1) % 4]!;
    return {
      id: vertex.id,
      updates: {
        x: vertex.x,
        y: vertex.y,
        handleIn: {
          x: previousRadial.x * handleScale,
          y: previousRadial.y * handleScale,
        },
        handleOut: {
          x: nextRadial.x * handleScale,
          y: nextRadial.y * handleScale,
        },
        handleMode: 'mirrored',
      },
    };
  });
}

export function buildAngleLockedQuadVertexUpdates(
  mask: ClipMask,
  vertexId: string,
  target: { x: number; y: number },
): Array<{ id: string; updates: Partial<MaskVertex> }> | null {
  if (!mask.closed || mask.vertices.length !== 4 || !isStraightCornerQuad(mask)) return null;
  const index = mask.vertices.findIndex(vertex => vertex.id === vertexId);
  if (index < 0) return null;

  const current = mask.vertices[index];
  const previous = mask.vertices[(index + 3) % 4];
  const next = mask.vertices[(index + 1) % 4];
  const opposite = mask.vertices[(index + 2) % 4];
  if (!current || !previous || !next || !opposite) return null;

  const previousPoint = lineIntersection(
    target,
    { x: current.x - previous.x, y: current.y - previous.y },
    opposite,
    { x: previous.x - opposite.x, y: previous.y - opposite.y },
  );
  const nextPoint = lineIntersection(
    target,
    { x: next.x - current.x, y: next.y - current.y },
    opposite,
    { x: next.x - opposite.x, y: next.y - opposite.y },
  );
  if (!previousPoint || !nextPoint) return null;

  return [
    { id: current.id, updates: target },
    { id: previous.id, updates: previousPoint },
    { id: next.id, updates: nextPoint },
  ];
}

export function buildGlobalMaskScaleVertexUpdates(
  mask: ClipMask,
  vertexId: string,
  target: { x: number; y: number },
): Array<{ id: string; updates: Partial<MaskVertex> }> | null {
  const draggedVertex = mask.vertices.find(vertex => vertex.id === vertexId);
  if (!draggedVertex || mask.vertices.length < 2) return null;

  const center = getMaskGeometryCenter(mask.vertices);
  const startVector = {
    x: draggedVertex.x - center.x,
    y: draggedVertex.y - center.y,
  };
  const targetVector = {
    x: target.x - center.x,
    y: target.y - center.y,
  };
  const startLengthSquared = startVector.x * startVector.x + startVector.y * startVector.y;
  if (startLengthSquared < 0.0000001) return null;

  const scale = (targetVector.x * startVector.x + targetVector.y * startVector.y) / startLengthSquared;
  return mask.vertices.map(vertex => ({
    id: vertex.id,
    updates: {
      x: center.x + (vertex.x - center.x) * scale,
      y: center.y + (vertex.y - center.y) * scale,
      handleIn: {
        x: vertex.handleIn.x * scale,
        y: vertex.handleIn.y * scale,
      },
      handleOut: {
        x: vertex.handleOut.x * scale,
        y: vertex.handleOut.y * scale,
      },
    },
  }));
}

export function shouldResizeMaskShape(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.ctrlKey || event.metaKey;
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
  const { selectVertex, setMaskDragging } = useTimelineStore();
  const previewOwnerId = useId();

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
    if (e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();

    if (!activeMask || !selectedClip) return;

    const vertex = activeMask.vertices.find(v => v.id === vertexId);
    if (!vertex) return;

    const currentSelection = useTimelineStore.getState().selectedVertexIds;
    const addToSelection = false;
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

    clearMaskPathDragPreview(previewOwnerId);
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
    let dragBatch: MaskPathDragBatch | null = null;
    let latestVertexUpdates: MaskVertexUpdate[] = [];
    let latestPreviewMask = activeMask;
    const historyLabel = handleType === 'vertex'
      ? 'Move mask vertices'
      : 'Adjust mask bezier handle';

    const publishVertexUpdates = (vertexUpdates: MaskVertexUpdate[]) => {
      latestVertexUpdates = vertexUpdates;
      latestPreviewMask = applyMaskVertexUpdates(activeMask, vertexUpdates);
      publishMaskPathDragPreview(previewOwnerId, selectedClip.id, latestPreviewMask);
    };

    const applyMouseMove = (moveEvent: MouseEvent) => {
      if (!dragState.current.vertexId || !dragState.current.handleType) return;
      if (!selectedClip || !activeMask) return;

      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;

      const isShiftPressed = moveEvent.shiftKey;
      if (
        !dragState.current.didDrag &&
        Math.hypot(
          moveEvent.clientX - dragState.current.startX,
          moveEvent.clientY - dragState.current.startY,
        ) > 2
      ) {
        dragState.current.didDrag = true;
        dragBatch = startBatch(historyLabel);
      }
      if (!dragState.current.didDrag) return;

      if (isShiftPressed && !dragState.current.lastShiftState) {
        dragState.current.shiftStartX = moveEvent.clientX;
        const currentVertex = latestPreviewMask.vertices.find(
          vertex => vertex.id === dragState.current.vertexId,
        );
        if (currentVertex) {
          dragState.current.shiftStartVertexX = currentVertex.x;
          dragState.current.shiftStartVertexY = currentVertex.y;
        }
      }
      dragState.current.lastShiftState = isShiftPressed;

      if (dragState.current.handleType === 'vertex') {
        const resizeShape = shouldResizeMaskShape(moveEvent);
        if (isShiftPressed && !resizeShape) {
          const shiftDx = (moveEvent.clientX - dragState.current.shiftStartX) * scaleX;
          const normalizedShiftDx = shiftDx / canvasWidth;
          const scaleFactor = 1 + normalizedShiftDx * 5;

          publishVertexUpdates([{
            id: dragState.current.vertexId,
            updates: {
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
            },
          }]);
        } else {
          const localPoint = clientToLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
          const normalizedDx = localPoint
            ? localPoint.x - dragState.current.startLocalX
            : ((moveEvent.clientX - dragState.current.startX) * scaleX) / canvasWidth;
          const normalizedDy = localPoint
            ? localPoint.y - dragState.current.startLocalY
            : ((moveEvent.clientY - dragState.current.startY) * scaleY) / canvasHeight;
          const axisLocked = resizeShape && moveEvent.shiftKey
            ? Math.abs(normalizedDx) >= Math.abs(normalizedDy)
              ? { dx: normalizedDx, dy: 0 }
              : { dx: 0, dy: normalizedDy }
            : { dx: normalizedDx, dy: normalizedDy };

          const target = {
            x: dragState.current.startVertexX + axisLocked.dx,
            y: dragState.current.startVertexY + axisLocked.dy,
          };
          const lockedUpdates = resizeShape && dragState.current.startVertices.length === 1
            ? buildEllipseResizeVertexUpdates(activeMask, dragState.current.vertexId, target)
              ?? buildAngleLockedQuadVertexUpdates(activeMask, dragState.current.vertexId, target)
              ?? buildGlobalMaskScaleVertexUpdates(activeMask, dragState.current.vertexId, target)
            : null;
          const vertexUpdates = lockedUpdates ?? dragState.current.startVertices.map(startVertex => ({
            id: startVertex.id,
            updates: {
              x: startVertex.x + axisLocked.dx,
              y: startVertex.y + axisLocked.dy,
            },
          }));
          publishVertexUpdates(vertexUpdates);
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
        const currentVertex = latestPreviewMask.vertices.find(
          vertex => vertex.id === dragState.current.vertexId,
        );
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

        publishVertexUpdates([{
          id: dragState.current.vertexId,
          updates,
        }]);
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
      if (didDrag && dragBatch) {
        commitMaskPathDrag(
          useTimelineStore.getState(),
          selectedClip.id,
          activeMask,
          latestVertexUpdates,
          historyLabel,
          dragBatch,
        );
      }
      clearMaskPathDragPreview(previewOwnerId);
      setMaskDragging(false);
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
      window.removeEventListener('blur', handleMouseUp);
      onDragEnd?.(didDrag);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);
  }, [
    activeMask,
    canvasHeight,
    canvasWidth,
    clientToLocalPoint,
    onDragEnd,
    previewOwnerId,
    selectedClip,
    selectVertex,
    setMaskDragging,
    svgRef,
  ]);

  return { handleVertexMouseDown };
}
