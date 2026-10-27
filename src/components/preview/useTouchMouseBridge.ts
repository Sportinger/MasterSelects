import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const BRIDGED_MOUSE_EVENT_MARKER = '__masterSelectsTouchMouseBridge';
const CLICK_MOVE_TOLERANCE_PX = 5;
const COMPATIBILITY_CLICK_SUPPRESSION_MS = 1_000;
/** The browser's compatibility click lands on the touched element where the finger lifted; a tap elsewhere is a new, real tap. */
const COMPATIBILITY_CLICK_RADIUS_PX = 24;

type TouchMouseBridgeElement = HTMLElement | SVGElement;

type MarkedMouseEvent = MouseEvent & {
  [BRIDGED_MOUSE_EVENT_MARKER]?: boolean;
};

interface ActiveTouch {
  moved: boolean;
  pointerId: number;
  startTarget: Element;
  startX: number;
  startY: number;
}

export interface TouchMouseBridgeHandlers<T extends TouchMouseBridgeElement> {
  onClickCapture: (event: ReactMouseEvent<T>) => void;
  onPointerCancel: (event: ReactPointerEvent<T>) => void;
  onPointerDown: (event: ReactPointerEvent<T>) => void;
  onPointerMove: (event: ReactPointerEvent<T>) => void;
  onPointerUp: (event: ReactPointerEvent<T>) => void;
}

export interface TouchMouseBridgeOptions<T extends TouchMouseBridgeElement> {
  enabled?: boolean;
  emitClick?: boolean;
  shouldStart?: (event: ReactPointerEvent<T>) => boolean;
}

/** True for the mouse events this bridge synthesizes from a finger (they carry no pointer-lock movement). */
export function isTouchBridgedMouseEvent(event: Event): boolean {
  return Boolean((event as MarkedMouseEvent)[BRIDGED_MOUSE_EVENT_MARKER]);
}

function dispatchBridgedMouseEvent(
  type: 'click' | 'mousedown' | 'mousemove' | 'mouseup',
  target: Element,
  pointerEvent: ReactPointerEvent,
): void {
  const isReleased = type === 'click' || type === 'mouseup';
  const mouseEvent = new MouseEvent(type, {
    altKey: pointerEvent.altKey,
    bubbles: true,
    button: 0,
    buttons: isReleased ? 0 : 1,
    cancelable: true,
    clientX: pointerEvent.clientX,
    clientY: pointerEvent.clientY,
    ctrlKey: pointerEvent.ctrlKey,
    detail: type === 'click' ? 1 : 0,
    metaKey: pointerEvent.metaKey,
    screenX: pointerEvent.screenX,
    screenY: pointerEvent.screenY,
    shiftKey: pointerEvent.shiftKey,
  });
  Object.defineProperty(mouseEvent, BRIDGED_MOUSE_EVENT_MARKER, { value: true });
  target.dispatchEvent(mouseEvent);
}

/**
 * Feeds real touch PointerEvents into an existing mouse-drag surface.
 * This keeps the established drag, preview, history, and commit paths intact
 * while making their full move/up stream available on iPad Safari.
 */
export function useTouchMouseBridge<T extends TouchMouseBridgeElement>({
  enabled = true,
  emitClick = true,
  shouldStart,
}: TouchMouseBridgeOptions<T> = {}): TouchMouseBridgeHandlers<T> {
  const activeTouchRef = useRef<ActiveTouch | null>(null);
  const suppressCompatibilityClickRef = useRef<{ until: number; x: number; y: number; target: Element } | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<T>) => {
    if (
      !enabled
      || event.pointerType !== 'touch'
      || event.button !== 0
      || event.isPrimary === false
      || activeTouchRef.current !== null
      || !(event.target instanceof Element)
      || (shouldStart && !shouldStart(event))
    ) return;

    event.preventDefault();
    activeTouchRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startTarget: event.target,
      startX: event.clientX,
      startY: event.clientY,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Safari can reject capture when the touched SVG node changes during a render.
    }
    dispatchBridgedMouseEvent('mousedown', event.target, event);
  }, [enabled, shouldStart]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const activeTouch = activeTouchRef.current;
    if (!activeTouch || activeTouch.pointerId !== event.pointerId) return;

    event.preventDefault();
    activeTouch.moved = activeTouch.moved || Math.hypot(
      event.clientX - activeTouch.startX,
      event.clientY - activeTouch.startY,
    ) > CLICK_MOVE_TOLERANCE_PX;
    const target = activeTouch.startTarget.isConnected
      ? activeTouch.startTarget
      : event.currentTarget;
    dispatchBridgedMouseEvent('mousemove', target, event);
  }, []);

  const finishTouch = useCallback((event: ReactPointerEvent<T>, cancelled: boolean) => {
    const activeTouch = activeTouchRef.current;
    if (!activeTouch || activeTouch.pointerId !== event.pointerId) return;
    activeTouchRef.current = null;
    event.preventDefault();

    const target = activeTouch.startTarget.isConnected
      ? activeTouch.startTarget
      : event.currentTarget;
    dispatchBridgedMouseEvent('mouseup', target, event);
    suppressCompatibilityClickRef.current = {
      until: performance.now() + COMPATIBILITY_CLICK_SUPPRESSION_MS,
      x: event.clientX,
      y: event.clientY,
      target: activeTouch.startTarget,
    };

    if (emitClick && !cancelled && !activeTouch.moved) {
      dispatchBridgedMouseEvent('click', target, event);
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Capture may already have been released by Safari or a pinch cancellation.
    }
  }, [emitClick]);

  const handleClickCapture = useCallback((event: ReactMouseEvent<T>) => {
    if ((event.nativeEvent as MarkedMouseEvent)[BRIDGED_MOUSE_EVENT_MARKER]) return;
    const suppression = suppressCompatibilityClickRef.current;
    if (!suppression || performance.now() >= suppression.until) return;
    const onTouchedElement = event.target instanceof Node && suppression.target.contains(event.target);
    const atLiftPoint = Math.hypot(event.clientX - suppression.x, event.clientY - suppression.y) <= COMPATIBILITY_CLICK_RADIUS_PX;
    if (!onTouchedElement && !atLiftPoint) return;
    suppressCompatibilityClickRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onClickCapture: handleClickCapture,
    onPointerCancel: event => finishTouch(event, true),
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: event => finishTouch(event, false),
  };
}
