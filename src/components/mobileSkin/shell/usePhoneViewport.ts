// Publishes the visual viewport as CSS variables on the shell root so the layout follows the
// real visible area (mobile browser chrome, on-screen keyboard) without re-rendering React.
import { useEffect, type RefObject } from 'react';

export const PHONE_VIEWPORT_VARS = {
  height: '--phone-vh',
  keyboardInset: '--phone-keyboard-inset',
} as const;

export function computeKeyboardInset(layoutHeight: number, viewportHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(layoutHeight - viewportHeight - offsetTop));
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
      const inset = viewport ? computeKeyboardInset(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
      root.style.setProperty(PHONE_VIEWPORT_VARS.height, `${Math.round(height)}px`);
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
