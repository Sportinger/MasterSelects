import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';

import {
  dispatchTransitionTouchDragBridgeEvent,
  getActiveTransitionDragData,
  setActiveTransitionDragData,
  type TransitionDropData,
} from '../../timeline/transitionDragData';

const TOUCH_DRAG_ARM_DELAY_MS = 140;
const TOUCH_DRAG_START_DISTANCE_PX = 14;
const TOUCH_SCROLL_DISTANCE_PX = 8;
const TOUCH_DRAG_GHOST_WIDTH_PX = 176;
const TOUCH_DRAG_GHOST_OFFSET_X_PX = 14;
const TOUCH_DRAG_GHOST_OFFSET_Y_PX = 58;

interface TransitionTouchTimelineDragInput {
  data: TransitionDropData;
  disabled: boolean;
  dragStartedRef: MutableRefObject<boolean>;
  label: string;
}

function createTouchDragGhost(sourceElement: HTMLElement, label: string): HTMLDivElement {
  document.querySelectorAll('.transition-touch-drag-ghost').forEach((element) => element.remove());

  const ghost = document.createElement('div');
  ghost.className = 'transition-touch-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');

  const preview = sourceElement.querySelector('.transition-item-preview')?.cloneNode(true);
  if (preview instanceof HTMLElement) {
    preview.classList.add('transition-touch-drag-ghost-preview');
    ghost.appendChild(preview);
  }

  const copy = document.createElement('strong');
  copy.textContent = label;
  ghost.appendChild(copy);
  document.body.appendChild(ghost);
  return ghost;
}

function positionTouchDragGhost(ghost: HTMLElement, clientX: number, clientY: number): void {
  const margin = 10;
  const x = Math.max(
    margin,
    Math.min(window.innerWidth - TOUCH_DRAG_GHOST_WIDTH_PX - margin, clientX + TOUCH_DRAG_GHOST_OFFSET_X_PX),
  );
  const y = Math.max(margin, clientY - TOUCH_DRAG_GHOST_OFFSET_Y_PX);
  ghost.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;

  const target = typeof document.elementFromPoint === 'function'
    ? document.elementFromPoint(clientX, clientY)
    : null;
  ghost.classList.toggle(
    'is-over-timeline',
    target instanceof Element && target.closest('.timeline-container') !== null,
  );
}

function suppressNextClick(): void {
  const suppress = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener('click', suppress, { capture: true, once: true });
  window.setTimeout(() => document.removeEventListener('click', suppress, true), 400);
}

export function useTransitionTouchTimelineDrag({
  data,
  disabled,
  dragStartedRef,
  label,
}: TransitionTouchTimelineDragInput) {
  const cancelActiveGestureRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelActiveGestureRef.current?.(), []);

  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return;

    cancelActiveGestureRef.current?.();

    const pointerId = event.pointerId;
    const sourceElement = event.currentTarget;
    const startedOnPreview = event.target instanceof Element
      && event.target.closest('.transition-item-preview') !== null;
    const startX = event.clientX;
    const startY = event.clientY;
    let armed = false;
    let dragging = false;
    let finished = false;
    let latestX = startX;
    let latestY = startY;
    let dragGhost: HTMLDivElement | null = null;

    const armTimer = window.setTimeout(() => {
      armed = true;
    }, TOUCH_DRAG_ARM_DELAY_MS);

    const clearDataIfCurrent = () => {
      if (getActiveTransitionDragData() === data) setActiveTransitionDragData(null);
    };

    const removeListeners = () => {
      window.clearTimeout(armTimer);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('pointerdown', handleAdditionalPointerDown, true);
      window.removeEventListener('touchmove', handleTouchMove, true);
      try {
        if (sourceElement.hasPointerCapture(pointerId)) sourceElement.releasePointerCapture(pointerId);
      } catch {
        // The panel may have re-rendered while the pointer was captured.
      }
    };

    const finish = (phase: 'drop' | 'cancel') => {
      if (finished) return;
      finished = true;
      removeListeners();
      cancelActiveGestureRef.current = null;
      sourceElement.classList.remove('touch-dragging');

      if (dragGhost) {
        const settledGhost = dragGhost;
        dragGhost = null;
        settledGhost.classList.add(phase === 'drop' ? 'is-dropping' : 'is-cancelling');
        window.setTimeout(() => settledGhost.remove(), phase === 'drop' ? 150 : 90);
      }

      if (!dragging) return;
      dispatchTransitionTouchDragBridgeEvent({ phase, clientX: latestX, clientY: latestY });
      if (phase === 'drop') {
        suppressNextClick();
        window.setTimeout(clearDataIfCurrent, 0);
      } else {
        clearDataIfCurrent();
      }
      window.setTimeout(() => {
        dragStartedRef.current = false;
      }, 400);
    };

    const startDragging = () => {
      if (dragging) return;
      dragging = true;
      dragStartedRef.current = true;
      setActiveTransitionDragData(data);
      sourceElement.classList.add('touch-dragging');
      dragGhost = createTouchDragGhost(sourceElement, label);
    };

    function handleTouchMove(touchEvent: TouchEvent) {
      if (armed || dragging) touchEvent.preventDefault();
    }

    function handleAdditionalPointerDown(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerType !== 'mouse' && pointerEvent.pointerId !== pointerId) finish('cancel');
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestX = pointerEvent.clientX;
      latestY = pointerEvent.clientY;
      const deltaX = latestX - startX;
      const deltaY = latestY - startY;
      const distance = Math.hypot(deltaX, deltaY);

      if (!armed && !dragging) {
        const directDragIntent = distance >= TOUCH_DRAG_START_DISTANCE_PX
          && (startedOnPreview || Math.abs(deltaX) > Math.abs(deltaY));
        if (directDragIntent) {
          startDragging();
        } else {
          const verticalScrollIntent = Math.abs(deltaY) >= TOUCH_SCROLL_DISTANCE_PX
            && Math.abs(deltaY) >= Math.abs(deltaX);
          if (verticalScrollIntent) finish('cancel');
          return;
        }
      }

      if (!dragging && distance >= TOUCH_DRAG_START_DISTANCE_PX) {
        startDragging();
      }
      if (!dragging) {
        return;
      }

      pointerEvent.preventDefault();
      if (dragGhost) positionTouchDragGhost(dragGhost, latestX, latestY);
      dispatchTransitionTouchDragBridgeEvent({ phase: 'move', clientX: latestX, clientY: latestY });
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      latestX = pointerEvent.clientX;
      latestY = pointerEvent.clientY;
      if (dragging) pointerEvent.preventDefault();
      finish('drop');
    }

    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId === pointerId) finish('cancel');
    }

    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerCancel, true);
    window.addEventListener('pointerdown', handleAdditionalPointerDown, true);
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    cancelActiveGestureRef.current = () => finish('cancel');

    try {
      sourceElement.setPointerCapture(pointerId);
    } catch {
      // Window listeners keep the gesture alive where pointer capture is unavailable.
    }
  }, [data, disabled, dragStartedRef, label]);
}
