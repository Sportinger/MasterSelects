import { useCallback, useEffect, useRef } from 'react';
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from 'react';

import type { TimelineTrackProps } from '../types';
import { isTimelineActiveTarget } from '../utils/timelineActiveTargets';

interface TimelineTrackClipTouchRowEventArgs {
  handleTimelineToolPointerClick: (
    event: ReactMouseEvent<HTMLDivElement>,
    clipId: string,
  ) => boolean;
  hitTestClipAtClientX: (clientX: number, rowEl: HTMLElement) => string | null;
  onClipDoubleClick: TimelineTrackProps['onClipDoubleClick'];
  onClipMouseDown: TimelineTrackProps['onClipMouseDown'];
  onTouchPointerHandled?: (clientX: number, clientY: number) => void;
  setHoveredClipId: Dispatch<SetStateAction<string | null>>;
}

interface CompletedClipTouchTap {
  clipId: string;
  completedAt: number;
  x: number;
  y: number;
}

const TOUCH_DOUBLE_TAP_INTERVAL_MS = 320;
const TOUCH_DOUBLE_TAP_DISTANCE_PX = 36;
const TOUCH_TAP_MAX_DURATION_MS = 240;
const TOUCH_TAP_MOVE_TOLERANCE_PX = 12;

function suppressTouchDoubleTapCompatibilityEvents(): void {
  const suppress = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const remove = () => {
    document.removeEventListener('click', suppress, true);
    document.removeEventListener('dblclick', suppress, true);
  };
  document.addEventListener('click', suppress, true);
  document.addEventListener('dblclick', suppress, true);
  window.setTimeout(remove, 400);
}

export function useTimelineTrackClipTouchRowEvent({
  handleTimelineToolPointerClick,
  hitTestClipAtClientX,
  onClipDoubleClick,
  onClipMouseDown,
  onTouchPointerHandled,
  setHoveredClipId,
}: TimelineTrackClipTouchRowEventArgs) {
  const previousTapRef = useRef<CompletedClipTouchTap | null>(null);
  const cancelTapTrackingRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelTapTrackingRef.current?.(), []);

  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch and pen do not produce a usable mousemove stream on iPad Safari.
    // Mouse input stays on the row's mouse handler for secondary-button tools.
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (isTimelineActiveTarget(target)) return;
    const hit = hitTestClipAtClientX(event.clientX, event.currentTarget);
    if (!hit) return;
    const clipId = hit;
    onTouchPointerHandled?.(event.clientX, event.clientY);
    setHoveredClipId(clipId);

    const startedAt = Date.now();
    const previousTap = previousTapRef.current;
    const isDoubleTap = previousTap !== null
      && previousTap.clipId === clipId
      && startedAt - previousTap.completedAt <= TOUCH_DOUBLE_TAP_INTERVAL_MS
      && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) <= TOUCH_DOUBLE_TAP_DISTANCE_PX;

    if (isDoubleTap) {
      previousTapRef.current = null;
      cancelTapTrackingRef.current?.();
      event.preventDefault();
      event.stopPropagation();
      suppressTouchDoubleTapCompatibilityEvents();
      onClipDoubleClick(event as unknown as ReactMouseEvent<HTMLDivElement>, clipId);
      return;
    }

    cancelTapTrackingRef.current?.();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      if (cancelTapTrackingRef.current === cleanup) cancelTapTrackingRef.current = null;
    };
    function handlePointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) > TOUCH_TAP_MOVE_TOLERANCE_PX) {
        moved = true;
      }
    }
    function handlePointerUp(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      const completedAt = Date.now();
      previousTapRef.current = !moved && completedAt - startedAt <= TOUCH_TAP_MAX_DURATION_MS
        ? { clipId, completedAt, x: pointerEvent.clientX, y: pointerEvent.clientY }
        : null;
    }
    function handlePointerCancel(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      cleanup();
      previousTapRef.current = null;
    }

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    cancelTapTrackingRef.current = cleanup;

    if (handleTimelineToolPointerClick(event, clipId)) return;
    onClipMouseDown(event, clipId);
  }, [
    handleTimelineToolPointerClick,
    hitTestClipAtClientX,
    onClipDoubleClick,
    onClipMouseDown,
    onTouchPointerHandled,
    setHoveredClipId,
  ]);
}
