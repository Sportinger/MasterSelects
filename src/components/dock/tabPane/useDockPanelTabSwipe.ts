import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type DockPanelTabSwipeMotion =
  | 'dock-panel-tab-swipe-exit-left'
  | 'dock-panel-tab-swipe-exit-right'
  | 'dock-panel-tab-swipe-enter-left'
  | 'dock-panel-tab-swipe-enter-right'
  | '';

export interface DockPanelTabSwipeHandlers {
  onMouseMoveCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseOverCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMoveCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerOverCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUpCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancelCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface UseDockPanelTabSwipeOptions {
  activeIndex: number;
  panelCount: number;
  onSelect: (index: number) => void;
}

interface SwipeGesture {
  axis: 'pending' | 'horizontal';
  currentX: number;
  currentY: number;
  pointerId: number;
  startX: number;
  startY: number;
  startTarget: Element;
}

const AXIS_LOCK_DISTANCE_PX = 12;
const SWIPE_DISTANCE_PX = 56;
const SWIPE_AXIS_RATIO = 1.25;
const EXIT_DURATION_MS = 175;
const ENTER_DURATION_MS = 300;
const CONTENT_RELEASE_DELAY_MS = EXIT_DURATION_MS + ENTER_DURATION_MS + 100;
const SYNTHETIC_CANCEL_MARKER = '__masterSelectsDockTabSwipeCancel';
const EDIT_GESTURE_OWNER_SELECTOR = [
  '.mask-overlay-svg',
  '.preview-container[data-preview-edit-mode="true"]',
  '[data-dock-tab-swipe-ignore="true"]',
].join(',');

type MarkedPointerEvent = PointerEvent & {
  [SYNTHETIC_CANCEL_MARKER]?: boolean;
};

function targetOwnsEditGesture(target: Element): boolean {
  return target.closest(EDIT_GESTURE_OWNER_SELECTOR) !== null;
}

function createTouchPointerEvent(
  type: 'pointercancel' | 'pointerout',
  gesture: SwipeGesture,
  relatedTarget?: EventTarget | null,
): Event {
  let event: Event;
  if (typeof PointerEvent === 'function') {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: type !== 'pointercancel',
      clientX: gesture.currentX,
      clientY: gesture.currentY,
      isPrimary: true,
      pointerId: gesture.pointerId,
      pointerType: 'touch',
      relatedTarget,
    });
  } else {
    event = new Event(type, { bubbles: true, cancelable: type !== 'pointercancel' });
    Object.defineProperties(event, {
      clientX: { value: gesture.currentX },
      clientY: { value: gesture.currentY },
      isPrimary: { value: true },
      pointerId: { value: gesture.pointerId },
      pointerType: { value: 'touch' },
      relatedTarget: { value: relatedTarget ?? null },
    });
  }
  return event;
}

function cancelContentGesture(gesture: SwipeGesture, boundary: HTMLElement): void {
  if (!gesture.startTarget.isConnected) return;

  const cancelEvent = createTouchPointerEvent('pointercancel', gesture);
  Object.defineProperty(cancelEvent, SYNTHETIC_CANCEL_MARKER, { value: true });
  gesture.startTarget.dispatchEvent(cancelEvent);

  // Clear JS-driven pointer/mouse hover as soon as the horizontal swipe wins.
  gesture.startTarget.dispatchEvent(createTouchPointerEvent('pointerout', gesture, boundary));
  gesture.startTarget.dispatchEvent(new MouseEvent('mouseout', {
    bubbles: true,
    clientX: gesture.currentX,
    clientY: gesture.currentY,
    relatedTarget: boundary,
  }));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function useDockPanelTabSwipe({
  activeIndex,
  panelCount,
  onSelect,
}: UseDockPanelTabSwipeOptions): {
  handlers: DockPanelTabSwipeHandlers;
  suppressContentInteractions: boolean;
  motionClass: DockPanelTabSwipeMotion;
} {
  const gestureRef = useRef<SwipeGesture | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const enterTimerRef = useRef<number | null>(null);
  const contentReleaseTimerRef = useRef<number | null>(null);
  const suppressContentInteractionsRef = useRef(false);
  const [suppressContentInteractions, setSuppressContentInteractions] = useState(false);
  const [motionClass, setMotionClass] = useState<DockPanelTabSwipeMotion>('');

  const clearTransitionTimers = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (enterTimerRef.current !== null) {
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearTransitionTimers();
    if (contentReleaseTimerRef.current !== null) {
      window.clearTimeout(contentReleaseTimerRef.current);
      contentReleaseTimerRef.current = null;
    }
    gestureRef.current = null;
    suppressContentInteractionsRef.current = false;
  }, [clearTransitionTimers]);

  const claimContentGesture = useCallback((gesture: SwipeGesture, boundary: HTMLDivElement) => {
    if (contentReleaseTimerRef.current !== null) {
      window.clearTimeout(contentReleaseTimerRef.current);
      contentReleaseTimerRef.current = null;
    }
    suppressContentInteractionsRef.current = true;
    setSuppressContentInteractions(true);
    cancelContentGesture(gesture, boundary);
  }, []);

  const scheduleContentRelease = useCallback(() => {
    if (contentReleaseTimerRef.current !== null) {
      window.clearTimeout(contentReleaseTimerRef.current);
    }
    contentReleaseTimerRef.current = window.setTimeout(() => {
      contentReleaseTimerRef.current = null;
      suppressContentInteractionsRef.current = false;
      setSuppressContentInteractions(false);
    }, CONTENT_RELEASE_DELAY_MS);
  }, []);

  const runTabTransition = useCallback((deltaX: number) => {
    const nextIndex = deltaX < 0 ? activeIndex + 1 : activeIndex - 1;
    if (nextIndex < 0 || nextIndex >= panelCount) return;

    clearTransitionTimers();
    if (prefersReducedMotion()) {
      setMotionClass('');
      onSelect(nextIndex);
      return;
    }

    const movesLeft = deltaX < 0;
    setMotionClass(movesLeft
      ? 'dock-panel-tab-swipe-exit-left'
      : 'dock-panel-tab-swipe-exit-right');

    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      onSelect(nextIndex);
      setMotionClass(movesLeft
        ? 'dock-panel-tab-swipe-enter-right'
        : 'dock-panel-tab-swipe-enter-left');

      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        setMotionClass('');
      }, ENTER_DURATION_MS);
    }, EXIT_DURATION_MS);
  }, [activeIndex, clearTransitionTimers, onSelect, panelCount]);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'touch'
      || event.button !== 0
      || event.isPrimary === false
      || panelCount < 2
      || motionClass !== ''
      || !(event.target instanceof Element)
      || targetOwnsEditGesture(event.target)
    ) return;

    if (gestureRef.current && gestureRef.current.pointerId !== event.pointerId) {
      gestureRef.current = null;
      return;
    }

    gestureRef.current = {
      axis: 'pending',
      currentX: event.clientX,
      currentY: event.clientY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTarget: event.target,
    };
  }, [motionClass, panelCount]);

  const handlePointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    const deltaX = gesture.currentX - gesture.startX;
    const deltaY = gesture.currentY - gesture.startY;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);

    if (gesture.axis === 'pending') {
      if (absoluteX < AXIS_LOCK_DISTANCE_PX && absoluteY < AXIS_LOCK_DISTANCE_PX) return;
      if (absoluteX >= absoluteY * SWIPE_AXIS_RATIO) {
        gesture.axis = 'horizontal';
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Window-level pointer delivery still completes the gesture in browsers without capture.
        }
        claimContentGesture(gesture, event.currentTarget);
      } else if (absoluteY >= absoluteX) {
        gestureRef.current = null;
        return;
      } else {
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();
  }, [claimContentGesture]);

  const finishGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if ((event.nativeEvent as MarkedPointerEvent)[SYNTHETIC_CANCEL_MARKER]) return;
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;

    if (gesture.axis !== 'horizontal') return;
    event.preventDefault();
    event.stopPropagation();
    scheduleContentRelease();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already have been released by Safari.
    }
    if (cancelled) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (
      Math.abs(deltaX) < SWIPE_DISTANCE_PX
      || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_AXIS_RATIO
    ) return;

    runTabTransition(deltaX);
  }, [runTabTransition, scheduleContentRelease]);

  const suppressSyntheticHover = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressContentInteractionsRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const suppressTouchPointerHover = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!suppressContentInteractionsRef.current || event.pointerType !== 'touch') return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handlers: DockPanelTabSwipeHandlers = {
    onMouseMoveCapture: suppressSyntheticHover,
    onMouseOverCapture: suppressSyntheticHover,
    onPointerDownCapture: handlePointerDownCapture,
    onPointerMoveCapture: handlePointerMoveCapture,
    onPointerOverCapture: suppressTouchPointerHover,
    onPointerUpCapture: event => finishGesture(event, false),
    onPointerCancelCapture: event => finishGesture(event, true),
  };

  return { handlers, motionClass, suppressContentInteractions };
}
