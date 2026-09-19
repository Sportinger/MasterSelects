import { useCallback, useId, useRef } from 'react';
import { startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import type { ClipMask } from '../../types/masks';
import type { TimelineClip } from '../../types/timeline';
import { buildMaskBoundsResizeUpdates, getMaskLocalBounds, type MaskBoundsCorner } from './maskOverlay/maskBoundsGeometry';
import {
  applyMaskVertexUpdates,
  clearMaskPathDragPreview,
  commitMaskPathDrag,
  publishMaskPathDragPreview,
  type MaskPathDragBatch,
  type MaskVertexUpdate,
} from './maskPathDragPreview';

interface BoundsResizeState {
  corner: MaskBoundsCorner | null;
  didDrag: boolean;
  pointerOffsetX: number;
  pointerOffsetY: number;
  startClientX: number;
  startClientY: number;
}

const idleBoundsResizeState = (): BoundsResizeState => ({
  corner: null,
  didDrag: false,
  pointerOffsetX: 0,
  pointerOffsetY: 0,
  startClientX: 0,
  startClientY: 0,
});

export function useMaskBoundsResize(
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToMaskPoint: (clientX: number, clientY: number) => { x: number; y: number } | null,
) {
  const { setMaskDragging } = useTimelineStore();
  const previewOwnerId = useId();
  const resizeState = useRef<BoundsResizeState>(idleBoundsResizeState());

  const handleBoundsResizeMouseDown = useCallback((event: React.MouseEvent, corner: MaskBoundsCorner) => {
    if (event.button !== 0 || !selectedClip || !activeMask) return;
    const bounds = getMaskLocalBounds(activeMask.vertices);
    const pointer = clientToMaskPoint(event.clientX, event.clientY);
    if (!bounds || !pointer) return;

    event.preventDefault();
    event.stopPropagation();
    const cornerPoint = {
      x: corner === 'topLeft' || corner === 'bottomLeft' ? bounds.minX : bounds.maxX,
      y: corner === 'topLeft' || corner === 'topRight' ? bounds.minY : bounds.maxY,
    };
    resizeState.current = {
      corner,
      didDrag: false,
      pointerOffsetX: pointer.x - cornerPoint.x,
      pointerOffsetY: pointer.y - cornerPoint.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };

    clearMaskPathDragPreview(previewOwnerId);
    let latestMoveEvent: MouseEvent | null = null;
    let moveFrame: number | null = null;
    let dragBatch: MaskPathDragBatch | null = null;
    let latestVertexUpdates: MaskVertexUpdate[] = [];

    const applyMouseMove = (moveEvent: MouseEvent) => {
      const state = resizeState.current;
      if (!state.corner) return;
      if (!state.didDrag) {
        if (Math.hypot(moveEvent.clientX - state.startClientX, moveEvent.clientY - state.startClientY) <= 2) return;
        state.didDrag = true;
        dragBatch = startBatch('Scale mask path');
        setMaskDragging(true);
      }

      const localPoint = clientToMaskPoint(moveEvent.clientX, moveEvent.clientY);
      if (!localPoint) return;
      const updates = buildMaskBoundsResizeUpdates(
        activeMask,
        state.corner,
        {
          x: localPoint.x - state.pointerOffsetX,
          y: localPoint.y - state.pointerOffsetY,
        },
        moveEvent.shiftKey,
      );
      if (!updates) return;

      latestVertexUpdates = updates;
      publishMaskPathDragPreview(
        previewOwnerId,
        selectedClip.id,
        applyMaskVertexUpdates(activeMask, updates),
      );
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestMoveEvent = moveEvent;
      if (moveFrame !== null) return;
      moveFrame = window.requestAnimationFrame(() => {
        moveFrame = null;
        if (latestMoveEvent) applyMouseMove(latestMoveEvent);
      });
    };

    const handleMouseUp = (upEvent?: MouseEvent) => {
      if (moveFrame !== null) {
        window.cancelAnimationFrame(moveFrame);
        moveFrame = null;
      }
      if (upEvent) latestMoveEvent = upEvent;
      if (latestMoveEvent) {
        applyMouseMove(latestMoveEvent);
        latestMoveEvent = null;
      }
      if (resizeState.current.didDrag && dragBatch) {
        commitMaskPathDrag(
          useTimelineStore.getState(),
          selectedClip.id,
          activeMask,
          latestVertexUpdates,
          'Scale mask path',
          dragBatch,
        );
      }
      clearMaskPathDragPreview(previewOwnerId);
      setMaskDragging(false);
      resizeState.current = idleBoundsResizeState();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
    };
    const handleBlur = () => handleMouseUp();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
  }, [activeMask, clientToMaskPoint, previewOwnerId, selectedClip, setMaskDragging]);

  return { handleBoundsResizeMouseDown };
}
