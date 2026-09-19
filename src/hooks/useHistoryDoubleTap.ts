import { useEffect, useRef } from 'react';

import { isEditableValueTouchSessionActive } from '../services/input/editableValueTouchSession';

export type TouchHistoryOperation = 'undo' | 'redo';

const DOUBLE_TAP_MAX_INTERVAL_MS = 320;
const TAP_MAX_DURATION_MS = 240;
const TAP_MOVE_TOLERANCE_PX = 12;
const DOUBLE_TAP_POSITION_TOLERANCE_PX = 56;
const CLICK_SUPPRESSION_MS = 450;
const HISTORY_GESTURE_SCOPE_SELECTOR = '[data-preview-panel-id]';
const INTERACTIVE_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[role="tab"]',
  '.dock-resize-handle',
  '.draggable-number',
  '.timeline-clip',
].join(',');

type TapSide = 'left' | 'right';

type ActiveTap = {
  pointerId: number;
  startedAt: number;
  startX: number;
  startY: number;
  cancelled: boolean;
};

type CompletedTap = {
  completedAt: number;
  side: TapSide;
  x: number;
  y: number;
};

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
}

function tapSide(clientX: number): TapSide {
  return clientX < window.innerWidth / 2 ? 'left' : 'right';
}

/** Maps a single-finger double tap inside Preview to undo/redo. */
export function useHistoryDoubleTap(
  onOperation: (operation: TouchHistoryOperation) => void,
): void {
  const onOperationRef = useRef(onOperation);

  useEffect(() => {
    onOperationRef.current = onOperation;
  }, [onOperation]);

  useEffect(() => {
    let activeTap: ActiveTap | null = null;
    let previousTap: CompletedTap | null = null;
    let suppressClickUntil = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      if (activeTap) {
        // Any overlapping second finger turns this into a multi-touch gesture.
        activeTap = null;
        previousTap = null;
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target?.closest(HISTORY_GESTURE_SCOPE_SELECTOR)
        || isEditableValueTouchSessionActive()
        || isInteractiveTarget(target)
      ) {
        previousTap = null;
        return;
      }

      activeTap = {
        pointerId: event.pointerId,
        startedAt: Date.now(),
        startX: event.clientX,
        startY: event.clientY,
        cancelled: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!activeTap || event.pointerId !== activeTap.pointerId) return;
      if (
        Math.hypot(
          event.clientX - activeTap.startX,
          event.clientY - activeTap.startY,
        ) > TAP_MOVE_TOLERANCE_PX
      ) {
        activeTap.cancelled = true;
      }
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if (!activeTap || event.pointerId !== activeTap.pointerId) return;
      const completed = activeTap;
      activeTap = null;
      const completedAt = Date.now();
      if (
        event.type === 'pointercancel'
        || completed.cancelled
        || completedAt - completed.startedAt > TAP_MAX_DURATION_MS
      ) {
        previousTap = null;
        return;
      }

      const nextTap: CompletedTap = {
        completedAt,
        side: tapSide(event.clientX),
        x: event.clientX,
        y: event.clientY,
      };
      const isDoubleTap = previousTap !== null
        && previousTap.side === nextTap.side
        && nextTap.completedAt - previousTap.completedAt <= DOUBLE_TAP_MAX_INTERVAL_MS
        && Math.hypot(nextTap.x - previousTap.x, nextTap.y - previousTap.y)
          <= DOUBLE_TAP_POSITION_TOLERANCE_PX;

      if (!isDoubleTap) {
        previousTap = nextTap;
        return;
      }

      previousTap = null;
      suppressClickUntil = completedAt + CLICK_SUPPRESSION_MS;
      event.preventDefault();
      event.stopPropagation();
      onOperationRef.current(nextTap.side === 'left' ? 'undo' : 'redo');
    };

    const handleClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
    window.addEventListener('pointerup', handlePointerFinish, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerFinish, { capture: true, passive: true });
    window.addEventListener('click', handleClick, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerFinish, true);
      window.removeEventListener('pointercancel', handlePointerFinish, true);
      window.removeEventListener('click', handleClick, true);
    };
  }, []);
}
