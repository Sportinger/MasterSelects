import { useCallback, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

const TOUCH_COMPATIBILITY_MOUSE_WINDOW_MS = 800;
const TOUCH_COMPATIBILITY_MOUSE_DISTANCE_PX = 40;

interface RecentTouchPointer {
  clientX: number;
  clientY: number;
  expiresAt: number;
}

export function useTouchCompatibilityMouseSuppression() {
  const recentTouchPointerRef = useRef<RecentTouchPointer | null>(null);

  const onTouchPointerHandled = useCallback((clientX: number, clientY: number) => {
    recentTouchPointerRef.current = {
      clientX,
      clientY,
      expiresAt: Date.now() + TOUCH_COMPATIBILITY_MOUSE_WINDOW_MS,
    };
  }, []);

  const suppressCompatibilityMouseEvent = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const recentTouchPointer = recentTouchPointerRef.current;
    if (recentTouchPointer && Date.now() > recentTouchPointer.expiresAt) {
      recentTouchPointerRef.current = null;
      return false;
    }
    if (
      event.button !== 0
      || !recentTouchPointer
      || Math.hypot(
        event.clientX - recentTouchPointer.clientX,
        event.clientY - recentTouchPointer.clientY,
      ) > TOUCH_COMPATIBILITY_MOUSE_DISTANCE_PX
    ) return false;

    recentTouchPointerRef.current = null;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  return { onTouchPointerHandled, suppressCompatibilityMouseEvent };
}
