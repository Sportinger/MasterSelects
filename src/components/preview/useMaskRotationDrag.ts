import { useCallback, useEffect, useId, useRef } from 'react';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { createMaskNumericProperty } from '../../types/animationProperties';
import type { ClipMask } from '../../types/masks';
import type { TimelineClip } from '../../types/timeline';
import { getMaskRotationCenter, type MaskTransformSize } from '../../utils/maskTransform';

interface RotationDragState {
  dragging: boolean;
  didDrag: boolean;
  startClientX: number;
  startClientY: number;
  previousPointerAngle: number;
  accumulatedAngle: number;
  startRotation: number;
  latestRotation: number;
}

function idleState(): RotationDragState {
  return {
    dragging: false,
    didDrag: false,
    startClientX: 0,
    startClientY: 0,
    previousPointerAngle: 0,
    accumulatedAngle: 0,
    startRotation: 0,
    latestRotation: 0,
  };
}

function normalizeAngleDelta(value: number): number {
  let result = value;
  while (result > 180) result -= 360;
  while (result < -180) result += 360;
  return result;
}

export function useMaskRotationDrag(
  selectedClip: TimelineClip | undefined,
  activeMask: ClipMask | undefined,
  clientToLayerPoint: (clientX: number, clientY: number) => { x: number; y: number } | null,
  sourceSize: MaskTransformSize,
) {
  const ownerId = useId();
  const dragState = useRef<RotationDragState>(idleState());
  const cleanupRef = useRef<(() => void) | null>(null);

  const clearPreview = useCallback(() => {
    useTimelineStore.setState(state => state.maskEditPreview?.ownerId === ownerId
      ? { maskEditPreview: null }
      : {});
  }, [ownerId]);

  useEffect(() => () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    clearPreview();
    if (dragState.current.dragging) useTimelineStore.getState().setMaskDragging(false);
    dragState.current = idleState();
  }, [clearPreview]);

  const handleRotationMouseDown = useCallback((event: React.MouseEvent<Element>) => {
    if (event.button !== 0 || !selectedClip || !activeMask) return;
    event.preventDefault();
    event.stopPropagation();

    const center = getMaskRotationCenter(activeMask);
    const pointer = clientToLayerPoint(event.clientX, event.clientY);
    if (!pointer) return;
    const pointerAngle = Math.atan2(
      (pointer.y - center.y) * sourceSize.height,
      (pointer.x - center.x) * sourceSize.width,
    ) * 180 / Math.PI;
    const startRotation = activeMask.rotation ?? 0;
    dragState.current = {
      dragging: true,
      didDrag: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      previousPointerAngle: pointerAngle,
      accumulatedAngle: 0,
      startRotation,
      latestRotation: startRotation,
    };

    let latestEvent: MouseEvent | null = null;
    let frame: number | null = null;

    const applyMove = (moveEvent: MouseEvent) => {
      const state = dragState.current;
      if (!state.dragging) return;
      const nextPointer = clientToLayerPoint(moveEvent.clientX, moveEvent.clientY);
      if (!nextPointer) return;

      const nextAngle = Math.atan2(
        (nextPointer.y - center.y) * sourceSize.height,
        (nextPointer.x - center.x) * sourceSize.width,
      ) * 180 / Math.PI;
      state.accumulatedAngle += normalizeAngleDelta(nextAngle - state.previousPointerAngle);
      state.previousPointerAngle = nextAngle;
      state.didDrag = state.didDrag || Math.hypot(
        moveEvent.clientX - state.startClientX,
        moveEvent.clientY - state.startClientY,
      ) > 2;
      if (!state.didDrag) return;

      const unconstrained = state.startRotation + state.accumulatedAngle;
      state.latestRotation = moveEvent.shiftKey ? Math.round(unconstrained / 15) * 15 : unconstrained;
      useTimelineStore.getState().setMaskDragging(true);
      useTimelineStore.setState({
        maskEditPreview: {
          ownerId,
          clipId: selectedClip.id,
          mask: { ...activeMask, rotation: state.latestRotation },
        },
      });
    };

    const handleMove = (moveEvent: MouseEvent) => {
      latestEvent = moveEvent;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (latestEvent) applyMove(latestEvent);
      });
    };

    const cleanup = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('blur', handleUp);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };

    const handleUp = () => {
      if (latestEvent) applyMove(latestEvent);
      const finalState = dragState.current;
      if (finalState.didDrag) {
        const batch = startBatch('Rotate mask');
        try {
          const store = useTimelineStore.getState();
          store.setPropertyValue(
            selectedClip.id,
            createMaskNumericProperty(activeMask.id, 'rotation'),
            finalState.latestRotation,
          );
          store.invalidateCache();
        } finally {
          if (batch.opened) endBatch();
        }
      }
      clearPreview();
      useTimelineStore.getState().setMaskDragging(false);
      dragState.current = idleState();
      cleanup();
    };

    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('blur', handleUp);
  }, [activeMask, clearPreview, clientToLayerPoint, ownerId, selectedClip, sourceSize.height, sourceSize.width]);

  return { handleRotationMouseDown };
}
