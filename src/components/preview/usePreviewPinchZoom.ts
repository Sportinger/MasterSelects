import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { isEditableValueTouchSessionActive } from '../../services/input/editableValueTouchSession';

type PinchPointer = {
  clientX: number;
  clientY: number;
  target: Element;
};

export interface PreviewPinchTranslation {
  x: number;
  y: number;
}

interface UsePreviewPinchZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  handleWheel: (event: WheelEvent) => void;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  zoomSpeed?: number;
}

export const PREVIEW_PINCH_WHEEL_SENSITIVITY = 0.0025;
const SYNTHETIC_PINCH_CANCEL_MARKER = '__masterSelectsPreviewPinchCancel';
const SYNTHETIC_PINCH_WHEEL_MARKER = '__masterSelectsPreviewPinchWheel';
const SYNTHETIC_PINCH_TRANSLATION_MARKER = '__masterSelectsPreviewPinchTranslation';

function getDistance(first: PinchPointer, second: PinchPointer): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export function isPreviewPinchWheelEvent(event: WheelEvent): boolean {
  return Boolean((event as WheelEvent & Record<string, unknown>)[SYNTHETIC_PINCH_WHEEL_MARKER]);
}

export function getPreviewPinchTranslation(event: WheelEvent): PreviewPinchTranslation {
  const translation = (event as WheelEvent & Record<string, unknown>)[SYNTHETIC_PINCH_TRANSLATION_MARKER];
  if (!translation || typeof translation !== 'object') return { x: 0, y: 0 };
  const { x, y } = translation as Partial<PreviewPinchTranslation>;
  return {
    x: typeof x === 'number' && Number.isFinite(x) ? x : 0,
    y: typeof y === 'number' && Number.isFinite(y) ? y : 0,
  };
}

function stopPinchEvent(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/** Routes a two-finger edit-mode pinch through the preview's existing zoom logic. */
export function usePreviewPinchZoom({
  containerRef,
  enabled,
  handleWheel,
  isCanvasInteractionTarget,
  zoomSpeed = 1,
}: UsePreviewPinchZoomOptions): void {
  const handleWheelRef = useRef(handleWheel);
  handleWheelRef.current = handleWheel;
  const zoomSpeedRef = useRef(zoomSpeed);
  zoomSpeedRef.current = zoomSpeed;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !enabled) return;

    const pointers = new Map<number, PinchPointer>();
    let gestureFrame: number | null = null;
    let suppressPointerStream = false;
    let pinch: {
      lastDistance: number;
      lastMidpoint: PreviewPinchTranslation;
      pointerIds: [number, number];
      target: Element;
    } | null = null;

    const cancelFirstTouchInteraction = (pointerId: number, target: Element) => {
      const cancelEvent = typeof PointerEvent === 'function'
        ? new PointerEvent('pointercancel', {
            bubbles: true,
            pointerId,
            pointerType: 'touch',
          })
        : new MouseEvent('pointercancel', { bubbles: true });
      Object.defineProperty(cancelEvent, 'pointerId', { configurable: true, value: pointerId });
      Object.defineProperty(cancelEvent, SYNTHETIC_PINCH_CANCEL_MARKER, { value: true });
      target.dispatchEvent(cancelEvent);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.pointerType !== 'touch'
        || isEditableValueTouchSessionActive()
        || !(event.target instanceof Element)
        || event.target.closest('.draggable-number') !== null
        || !isCanvasInteractionTarget(event.target)
      ) return;
      pointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      });
      if (pointers.size !== 2) return;

      const entries = [...pointers.entries()];
      const [[firstId, first], [secondId, second]] = entries;
      pinch = {
        lastDistance: Math.max(1, getDistance(first, second)),
        lastMidpoint: {
          x: (first.clientX + second.clientX) / 2,
          y: (first.clientY + second.clientY) / 2,
        },
        pointerIds: [firstId, secondId],
        target: first.target,
      };
      suppressPointerStream = true;
      cancelFirstTouchInteraction(firstId, first.target);
      stopPinchEvent(event);
    };

    const flushPinchGesture = () => {
      gestureFrame = null;
      if (!pinch) return;
      const [first, second] = pinch.pointerIds.map(pointerId => pointers.get(pointerId));
      if (!first || !second) return;
      const nextDistance = Math.max(1, getDistance(first, second));
      const scale = nextDistance / pinch.lastDistance;
      const nextMidpoint = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
      const translation = {
        x: nextMidpoint.x - pinch.lastMidpoint.x,
        y: nextMidpoint.y - pinch.lastMidpoint.y,
      };
      pinch.lastDistance = nextDistance;
      pinch.lastMidpoint = nextMidpoint;
      if (!Number.isFinite(scale)) return;
      if (
        Math.abs(scale - 1) < Number.EPSILON
        && Math.abs(translation.x) < Number.EPSILON
        && Math.abs(translation.y) < Number.EPSILON
      ) return;

      const wheelEvent = new WheelEvent('wheel', {
        bubbles: false,
        cancelable: true,
        clientX: nextMidpoint.x,
        clientY: nextMidpoint.y,
        deltaY: (-Math.log(scale) / PREVIEW_PINCH_WHEEL_SENSITIVITY) * zoomSpeedRef.current,
      });
      Object.defineProperty(wheelEvent, 'target', { configurable: true, value: pinch.target });
      Object.defineProperty(wheelEvent, SYNTHETIC_PINCH_WHEEL_MARKER, { value: true });
      Object.defineProperty(wheelEvent, SYNTHETIC_PINCH_TRANSLATION_MARKER, { value: translation });
      handleWheelRef.current(wheelEvent);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = pointers.get(event.pointerId);
      if (!current) return;
      pointers.set(event.pointerId, {
        ...current,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (!pinch) return;

      stopPinchEvent(event);
      if (gestureFrame === null) {
        gestureFrame = requestAnimationFrame(flushPinchGesture);
      }
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if ((event as PointerEvent & Record<string, unknown>)[SYNTHETIC_PINCH_CANCEL_MARKER]) return;
      if (!pointers.has(event.pointerId)) return;
      if (gestureFrame !== null) {
        cancelAnimationFrame(gestureFrame);
        flushPinchGesture();
      }
      const shouldStop = suppressPointerStream;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) suppressPointerStream = false;
      if (shouldStop) stopPinchEvent(event);
    };

    element.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerFinish, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerFinish, { capture: true, passive: false });
    return () => {
      if (gestureFrame !== null) cancelAnimationFrame(gestureFrame);
      element.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerFinish, true);
      window.removeEventListener('pointercancel', handlePointerFinish, true);
    };
  }, [containerRef, enabled, isCanvasInteractionTarget]);
}
