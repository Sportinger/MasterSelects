// Edge segment dragging (move two adjacent vertices together)

import { useRef, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { createMaskPathProperty } from '../../types/animationProperties';
import type { ClipMask, MaskPathKeyframeValue, MaskVertex } from '../../types/masks';
import type { TimelineClip } from '../../types/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { createMaskEdgeId } from '../../utils/maskEdgeFeathers';

type EdgeDragVertex = { id: string; x: number; y: number };

function buildPathValueWithVertexUpdates(
  mask: ClipMask,
  vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>,
): MaskPathKeyframeValue {
  const updatesById = new Map(vertexUpdates.map(({ id, updates }) => [id, updates]));
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => {
      const updates = updatesById.get(vertex.id);
      const nextVertex = updates ? { ...vertex, ...updates } : vertex;
      return {
        ...nextVertex,
        handleIn: updates?.handleIn ? { ...updates.handleIn } : { ...vertex.handleIn },
        handleOut: updates?.handleOut ? { ...updates.handleOut } : { ...vertex.handleOut },
      };
    }),
  };
}

function recordPathIfAnimated(clipId: string, mask: ClipMask, vertexUpdates: Array<{ id: string; updates: Partial<MaskVertex> }>): void {
  const store = useTimelineStore.getState();
  const property = createMaskPathProperty(mask.id);
  if (!store.isRecording(clipId, property) && !store.hasKeyframes(clipId, property)) return;
  store.addMaskPathKeyframe(
    clipId,
    mask.id,
    buildPathValueWithVertexUpdates(mask, vertexUpdates),
    undefined,
    'linear',
    {
      phase: 'update',
      source: 'ui',
      historyLabel: 'Move mask edge',
    },
  );
}

function copyVertex(vertex: MaskVertex): EdgeDragVertex {
  return { id: vertex.id, x: vertex.x, y: vertex.y };
}

export function useMaskEdgeDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  canvasWidth: number,
  canvasHeight: number,
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLocalPoint?: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const { selectMaskEdge, setMaskDragging } = useTimelineStore();

  const edgeDragState = useRef<{
    isDragging: boolean;
    didStartDrag: boolean;
    startX: number;
    startY: number;
    startLocalX: number;
    startLocalY: number;
    vertexA: EdgeDragVertex;
    vertexB: EdgeDragVertex;
    previousA: EdgeDragVertex | null;
    nextB: EdgeDragVertex | null;
  }>({
    isDragging: false,
    didStartDrag: false,
    startX: 0,
    startY: 0,
    startLocalX: 0,
    startLocalY: 0,
    vertexA: { id: '', x: 0, y: 0 },
    vertexB: { id: '', x: 0, y: 0 },
    previousA: null,
    nextB: null,
  });

  const handleEdgeMouseDown = useCallback((e: React.MouseEvent, vertexIdA: string, vertexIdB: string) => {
    if (e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();
    if (!activeMask || !selectedClip) return;

    const indexA = activeMask.vertices.findIndex(v => v.id === vertexIdA);
    const indexB = activeMask.vertices.findIndex(v => v.id === vertexIdB);
    const vA = activeMask.vertices[indexA];
    const vB = activeMask.vertices[indexB];
    if (!vA || !vB) return;

    selectMaskEdge(createMaskEdgeId(vertexIdA, vertexIdB));

    const previousA = activeMask.closed || indexA > 0
      ? activeMask.vertices[(indexA - 1 + activeMask.vertices.length) % activeMask.vertices.length]
      : null;
    const nextB = activeMask.closed || indexB < activeMask.vertices.length - 1
      ? activeMask.vertices[(indexB + 1) % activeMask.vertices.length]
      : null;

    const startLocalPoint = clientToLocalPoint?.(e.clientX, e.clientY);
    edgeDragState.current = {
      isDragging: true,
      didStartDrag: false,
      startX: e.clientX,
      startY: e.clientY,
      startLocalX: startLocalPoint?.x ?? 0,
      startLocalY: startLocalPoint?.y ?? 0,
      vertexA: copyVertex(vA),
      vertexB: copyVertex(vB),
      previousA: previousA ? copyVertex(previousA) : null,
      nextB: nextB ? copyVertex(nextB) : null,
    };

    let lastUpdate = 0;
    let lastClientX = e.clientX;
    let lastClientY = e.clientY;

    const buildEdgeUpdates = (dx: number, dy: number, snapToAxis: boolean, alignAdjacentEdges: boolean) => {
      const state = edgeDragState.current;
      const nextA = { x: state.vertexA.x + dx, y: state.vertexA.y + dy };
      const nextBPoint = { x: state.vertexB.x + dx, y: state.vertexB.y + dy };
      const horizontalEdge = Math.abs(state.vertexB.x - state.vertexA.x) >= Math.abs(state.vertexB.y - state.vertexA.y);

      if (snapToAxis) {
        if (horizontalEdge) {
          const y = (nextA.y + nextBPoint.y) / 2;
          nextA.y = y;
          nextBPoint.y = y;
        } else {
          const x = (nextA.x + nextBPoint.x) / 2;
          nextA.x = x;
          nextBPoint.x = x;
        }
      }

      if (alignAdjacentEdges) {
        if (horizontalEdge) {
          if (state.previousA) nextA.x = state.previousA.x;
          if (state.nextB) nextBPoint.x = state.nextB.x;
        } else {
          if (state.previousA) nextA.y = state.previousA.y;
          if (state.nextB) nextBPoint.y = state.nextB.y;
        }
      }

      return [
        { id: state.vertexA.id, updates: nextA },
        { id: state.vertexB.id, updates: nextBPoint },
      ];
    };

    const applyEdgeDrag = (clientX: number, clientY: number, shiftKey: boolean, alignAdjacentEdges: boolean) => {
      if (!edgeDragState.current.isDragging || !selectedClip || !activeMask) return;
      if (!edgeDragState.current.didStartDrag) return;

      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;

      const localPoint = clientToLocalPoint?.(clientX, clientY);
      const dx = localPoint
        ? localPoint.x - edgeDragState.current.startLocalX
        : (clientX - edgeDragState.current.startX) * scaleX / canvasWidth;
      const dy = localPoint
        ? localPoint.y - edgeDragState.current.startLocalY
        : (clientY - edgeDragState.current.startY) * scaleY / canvasHeight;

      const vertexUpdates = buildEdgeUpdates(dx, dy, shiftKey, alignAdjacentEdges);
      useTimelineStore.getState().updateVertices(selectedClip.id, activeMask.id, vertexUpdates, true);
      recordPathIfAnimated(selectedClip.id, activeMask, vertexUpdates);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;

      if (!edgeDragState.current.didStartDrag) {
        const moved = Math.hypot(moveEvent.clientX - edgeDragState.current.startX, moveEvent.clientY - edgeDragState.current.startY);
        if (moved <= 2) return;
        edgeDragState.current.didStartDrag = true;
        startBatch('Move mask edge');
        setMaskDragging(true);
      }

      const now = performance.now();
      if (now - lastUpdate < 16) return;
      lastUpdate = now;
      applyEdgeDrag(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey, moveEvent.ctrlKey || moveEvent.metaKey);
    };

    const handleKeyChange = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Shift' && keyEvent.key !== 'Control' && keyEvent.key !== 'Meta') return;
      applyEdgeDrag(lastClientX, lastClientY, keyEvent.shiftKey, keyEvent.ctrlKey || keyEvent.metaKey);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (edgeDragState.current.didStartDrag) {
        applyEdgeDrag(upEvent.clientX, upEvent.clientY, upEvent.shiftKey, upEvent.ctrlKey || upEvent.metaKey);
        const store = useTimelineStore.getState();
        store.invalidateCache();
        store.setMaskDragging(false);
        endBatch();
      }
      edgeDragState.current = {
        isDragging: false,
        didStartDrag: false,
        startX: 0,
        startY: 0,
        startLocalX: 0,
        startLocalY: 0,
        vertexA: { id: '', x: 0, y: 0 },
        vertexB: { id: '', x: 0, y: 0 },
        previousA: null,
        nextB: null,
      };
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyChange);
      window.removeEventListener('keyup', handleKeyChange);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyChange);
    window.addEventListener('keyup', handleKeyChange);
  }, [activeMask, selectedClip, canvasWidth, canvasHeight, selectMaskEdge, setMaskDragging, svgRef, clientToLocalPoint]);

  return { handleEdgeMouseDown };
}
