// Publishes the visual viewport as CSS variables on the shell root so the layout follows the
// real visible area (mobile browser chrome, on-screen keyboard) without re-rendering React.
import { useEffect, type RefObject } from 'react';

export const PHONE_VIEWPORT_VARS = {
  height: '--phone-vh',
  keyboardInset: '--phone-keyboard-inset',
} as const;

/**
 * The part of the shell the on-screen keyboard covers: how far the shell's bottom reaches below the
 * visible area's bottom (visualViewport.offsetTop + height), in px. The shell is already sized to the
 * visual viewport, so this is usually 0; counting the whole keyboard height again (layout height minus
 * visual height) lifted sheets a second keyboard height and squeezed the preview to nothing.
 */
export function computeKeyboardInset(shellBottom: number, visibleBottom: number): number {
  return Math.max(0, Math.round(shellBottom - visibleBottom));
}

export function usePhoneViewport(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const viewport = window.visualViewport;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const height = viewport ? viewport.height : window.innerHeight;
      root.style.setProperty(PHONE_VIEWPORT_VARS.height, `${Math.round(height)}px`);
      // Measured after the height applies (a fallback max-height may keep the shell taller).
      const inset = viewport
        ? computeKeyboardInset(root.getBoundingClientRect().bottom, viewport.offsetTop + viewport.height)
        : 0;
      root.style.setProperty(PHONE_VIEWPORT_VARS.keyboardInset, `${inset}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };

    apply();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, [rootRef]);
}
