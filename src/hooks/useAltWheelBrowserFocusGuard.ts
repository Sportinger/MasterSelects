import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Prevents Chromium from moving focus into its browser toolbar when Alt is
 * used as an editor wheel modifier over a specific surface.
 */
export function useAltWheelBrowserFocusGuard(
  targetRef: RefObject<HTMLElement | null>,
): () => void {
  const altWheelGestureRef = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const ownerWindow = target.ownerDocument.defaultView ?? window;
    let pointerInsideTarget = false;

    const handlePointerEnter = () => {
      pointerInsideTarget = true;
    };
    const handlePointerLeave = () => {
      pointerInsideTarget = false;
    };
    const isPointerOverTarget = () => {
      if (pointerInsideTarget) return true;
      try {
        return target.matches(':hover');
      } catch {
        return false;
      }
    };
    const preventChromeAltToolbarFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') return;
      if (isPointerOverTarget() || altWheelGestureRef.current) {
        event.preventDefault();
      }
      if (event.type === 'keyup') {
        altWheelGestureRef.current = false;
      }
    };
    const clearGesture = () => {
      pointerInsideTarget = false;
      altWheelGestureRef.current = false;
    };

    target.addEventListener('pointerenter', handlePointerEnter);
    target.addEventListener('pointerleave', handlePointerLeave);
    ownerWindow.addEventListener('keydown', preventChromeAltToolbarFocus, true);
    ownerWindow.addEventListener('keyup', preventChromeAltToolbarFocus, true);
    ownerWindow.addEventListener('blur', clearGesture);
    return () => {
      target.removeEventListener('pointerenter', handlePointerEnter);
      target.removeEventListener('pointerleave', handlePointerLeave);
      ownerWindow.removeEventListener('keydown', preventChromeAltToolbarFocus, true);
      ownerWindow.removeEventListener('keyup', preventChromeAltToolbarFocus, true);
      ownerWindow.removeEventListener('blur', clearGesture);
    };
  }, [targetRef]);

  return useCallback(() => {
    altWheelGestureRef.current = true;
  }, []);
}
